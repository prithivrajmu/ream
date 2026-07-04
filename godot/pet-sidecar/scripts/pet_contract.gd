extends RefCounted
class_name ReamPetContract

const DEEP_FOCUS_THRESHOLD_SECONDS := 25 * 60
const DAILY_GOAL_SECONDS := 8 * 60 * 60

const STATES := {
	"timer-running": {
		"label": "Timer running",
		"mood": "Energetic, alert, cheerful.",
		"crop": Rect2(20, 135, 300, 330),
		"scale": 0.58,
		"animation": "trot",
		"messages": [
			"I am monitoring productivity. Also crumbs.",
			"Run, apparently. I support this chaos.",
			"Fine, we are focused. Try to look natural."
		]
	},
	"timer-paused": {
		"label": "Timer paused",
		"mood": "Sitting still, slightly puzzled.",
		"crop": Rect2(370, 135, 300, 330),
		"scale": 0.58,
		"animation": "puzzled",
		"messages": [
			"Paused? Bold strategy.",
			"I sat down emotionally and physically.",
			"Wake me when ambition resumes."
		]
	},
	"no-timer-today": {
		"label": "No timer run today",
		"mood": "Slumped, sleepy, low-energy.",
		"crop": Rect2(660, 278, 390, 210),
		"scale": 0.56,
		"animation": "sleepy",
		"messages": [
			"A historic absence of timers.",
			"Nothing tracked. I respect the mystery.",
			"Today is currently theoretical."
		]
	},
	"deep-focus": {
		"label": "Deep focus",
		"mood": "Determined, focused, confident.",
		"crop": Rect2(1060, 140, 300, 330),
		"scale": 0.58,
		"animation": "sentinel",
		"messages": [
			"Do not disturb the wrinkles.",
			"We are locked in. I look serious for both of us.",
			"Deep focus detected. I have tightened my face."
		]
	},
	"task-completed": {
		"label": "Task completed",
		"mood": "Very happy, celebratory, proud.",
		"crop": Rect2(35, 550, 300, 350),
		"scale": 0.56,
		"animation": "celebrate",
		"messages": [
			"Acceptable. I will allow one celebration.",
			"Task done. My paws were instrumental.",
			"Victory. Try not to make it weird."
		]
	},
	"idle": {
		"label": "Idle / no active task",
		"mood": "Curious, sniffing, looking around.",
		"crop": Rect2(350, 570, 330, 330),
		"scale": 0.56,
		"animation": "sniff",
		"messages": [
			"I am available for vague supervision.",
			"No active task. Suspiciously peaceful.",
			"I sniffed the backlog. It sniffed back."
		]
	},
	"break-time": {
		"label": "Break time",
		"mood": "Relaxed, stretching, content.",
		"crop": Rect2(660, 680, 410, 220),
		"scale": 0.54,
		"animation": "stretch",
		"messages": [
			"Break approved. Hydrate, tiny legend.",
			"Stretching is productivity with fewer spreadsheets.",
			"I scheduled this nap-adjacent pause."
		]
	},
	"daily-goal-met": {
		"label": "Daily goal met",
		"mood": "Cozy, satisfied, sleepy-happy.",
		"crop": Rect2(1060, 680, 360, 220),
		"scale": 0.56,
		"animation": "cozy",
		"messages": [
			"Daily goal met. I am retiring immediately.",
			"You did it. I will now be insufferably cozy.",
			"Enough productivity. The wrinkles demand rest."
		]
	}
}

static func normalize_state_id(value: Variant) -> String:
	if value is String and STATES.has(value):
		return value
	return "idle"

static func state_definition(state_id: String) -> Dictionary:
	return STATES[normalize_state_id(state_id)]
