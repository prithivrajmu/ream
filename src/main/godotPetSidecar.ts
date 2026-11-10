import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { app } from "electron";

const CONTRACT_FILE_NAME = "ream-pet-contract.json";
const DEFAULT_STATE = "idle";

export interface GodotPetContract {
  state?: string;
  movementPaused?: boolean;
  message?: string;
}

export interface GodotPetSidecarStatus {
  running: boolean;
  pid: number | null;
  projectPath: string;
  contractPath: string;
}

export interface GodotPetSidecarHandle {
  status: () => GodotPetSidecarStatus;
  update: (contract: GodotPetContract) => void;
  close: () => Promise<void>;
}

export async function startGodotPetSidecar(initialContract: GodotPetContract = {}): Promise<GodotPetSidecarHandle> {
  const projectPath = getGodotPetProjectPath();
  if (!existsSync(projectPath)) {
    throw new Error(`Godot pet project was not found at ${projectPath}.`);
  }

  const contractPath = getGodotPetContractPath();
  writeContract(contractPath, initialContract);

  const godotBinary = process.env.REAM_GODOT_BIN?.trim() || "godot";
  const child = spawn(godotBinary, [
    "--path",
    projectPath,
    "--",
    `--ream-pet-contract=${contractPath}`
  ], {
    stdio: "ignore"
  });

  await waitForSpawn(child);

  return {
    status: () => ({
      running: child.exitCode === null && !child.killed,
      pid: child.pid ?? null,
      projectPath,
      contractPath
    }),
    update: (contract) => writeContract(contractPath, contract),
    close: () => closeProcess(child)
  };
}

function getGodotPetProjectPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "pet-sidecar");
  }

  return resolve(app.getAppPath(), "godot/pet-sidecar");
}

function getGodotPetContractPath(): string {
  return join(app.getPath("userData"), CONTRACT_FILE_NAME);
}

function normalizeContract(contract: GodotPetContract): Required<GodotPetContract> & { updatedAt: string } {
  return {
    state: contract.state?.trim() || DEFAULT_STATE,
    movementPaused: contract.movementPaused === true,
    message: contract.message?.trim() || "",
    updatedAt: new Date().toISOString()
  };
}

function writeContract(contractPath: string, contract: GodotPetContract): void {
  mkdirSync(dirname(contractPath), { recursive: true });
  writeFileSync(contractPath, `${JSON.stringify(normalizeContract(contract), null, 2)}\n`);
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    const cleanup = () => {
      child.off("error", rejectSpawn);
      child.off("spawn", resolveSpawn);
    };
    child.once("error", (error) => {
      cleanup();
      rejectSpawn(error);
    });
    child.once("spawn", () => {
      cleanup();
      resolveSpawn();
    });
  });
}

function closeProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return Promise.resolve();
  }

  return new Promise((resolveClose) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolveClose();
    }, 1200);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolveClose();
    });
    child.kill();
  });
}
