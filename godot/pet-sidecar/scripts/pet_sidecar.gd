extends Node2D

const ReamPetContract := preload("res://scripts/pet_contract.gd")
const CONTRACT_ARG_PREFIX := "--ream-pet-contract="
const MESSAGE_SECONDS := 1.9
const POLL_SECONDS := 0.25
const DEMO_STATES := [
	"idle",
	"timer-running",
	"deep-focus",
	"timer-paused",
	"break-time",
	"task-completed",
	"daily-goal-met",
	"no-timer-today"
]

@onready var sprite: Sprite2D = $Sprite
@onready var shadow: Polygon2D = $Shadow
@onready var animator: Node = $Animator
@onready var message_bubble: PanelContainer = $MessageBubble
@onready var message_text: Label = $MessageBubble/MessageText

var contract_path := ""
var state_id := "idle"
var state := {}
var message_until := 0.0
var next_poll_at := 0.0
var next_demo_state_at := 0.0
var demo_index := 0
var velocity := Vector2(1.2, 0.8)
var hover_paused_until := 0.0
var externally_paused := false

func _ready() -> void:
	randomize()
	_configure_window()
	contract_path = _read_contract_path()
	_apply_state("idle")
	_configure_bubble()

func _process(delta: float) -> void:
	var now := Time.get_ticks_msec() / 1000.0
	if now >= next_poll_at:
		next_poll_at = now + POLL_SECONDS
		_poll_contract(now)

	var paused := externally_paused or now < hover_paused_until or now < message_until
	_move_window(delta, paused)
	animator.tick(sprite, shadow, state, velocity.length() > 0.1, paused, delta)

	if now >= message_until:
		message_bubble.visible = false

func _input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		hover_paused_until = Time.get_ticks_msec() / 1000.0 + 0.8
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		hover_paused_until = Time.get_ticks_msec() / 1000.0 + MESSAGE_SECONDS
		_show_random_message()

func _configure_window() -> void:
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_ALWAYS_ON_TOP, true)
	DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_TRANSPARENT, true)
	get_viewport().transparent_bg = true

func _configure_bubble() -> void:
	var style := StyleBoxFlat.new()
	style.bg_color = Color(1.0, 0.985, 0.94, 0.96)
	style.border_color = Color(0.55, 0.36, 0.2, 0.18)
	style.set_border_width_all(1)
	style.set_corner_radius_all(14)
	style.content_margin_left = 11
	style.content_margin_right = 11
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	message_bubble.add_theme_stylebox_override("panel", style)
	message_text.add_theme_color_override("font_color", Color(0.25, 0.18, 0.13))
	message_text.add_theme_font_size_override("font_size", 13)

func _read_contract_path() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(CONTRACT_ARG_PREFIX):
			return arg.trim_prefix(CONTRACT_ARG_PREFIX)
	return ""

func _poll_contract(now: float) -> void:
	if contract_path.is_empty():
		_tick_demo_state(now)
		return

	if not FileAccess.file_exists(contract_path):
		return

	var parsed = JSON.parse_string(FileAccess.get_file_as_string(contract_path))
	if typeof(parsed) != TYPE_DICTIONARY:
		return

	_apply_state(ReamPetContract.normalize_state_id(parsed.get("state", state_id)))
	externally_paused = parsed.get("movementPaused", false) == true
	var message = parsed.get("message", "")
	if message is String and not message.is_empty():
		_show_message(message)

func _tick_demo_state(now: float) -> void:
	if now < next_demo_state_at:
		return
	next_demo_state_at = now + 5.0
	demo_index = (demo_index + 1) % DEMO_STATES.size()
	_apply_state(DEMO_STATES[demo_index])

func _apply_state(next_state_id: String) -> void:
	var normalized := ReamPetContract.normalize_state_id(next_state_id)
	if normalized == state_id and not state.is_empty():
		return
	state_id = normalized
	state = ReamPetContract.state_definition(state_id)
	animator.configure(sprite, state)

func _show_random_message() -> void:
	var messages: Array = state.messages
	_show_message(messages.pick_random())

func _show_message(message: String) -> void:
	message_text.text = message
	message_bubble.visible = true
	message_until = Time.get_ticks_msec() / 1000.0 + MESSAGE_SECONDS

func _move_window(delta: float, paused: bool) -> void:
	if paused:
		return

	if randf() < 0.015:
		velocity = Vector2(randf_range(-1.8, 1.8), randf_range(-1.2, 1.2))
		if abs(velocity.x) < 0.6:
			velocity.x = sign(velocity.x if velocity.x != 0 else 1.0) * 0.8

	var position := DisplayServer.window_get_position()
	var size := DisplayServer.window_get_size()
	var screen := DisplayServer.screen_get_usable_rect()
	var next := position + Vector2i(roundi(velocity.x * 42.0 * delta), roundi(velocity.y * 42.0 * delta))

	if next.x < screen.position.x or next.x + size.x > screen.position.x + screen.size.x:
		velocity.x *= -1.0
	if next.y < screen.position.y or next.y + size.y > screen.position.y + screen.size.y:
		velocity.y *= -1.0

	next.x = clamp(next.x, screen.position.x, screen.position.x + screen.size.x - size.x)
	next.y = clamp(next.y, screen.position.y, screen.position.y + screen.size.y - size.y)
	DisplayServer.window_set_position(next)
