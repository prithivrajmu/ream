extends Node
class_name ReamPetAnimator

var phase := 0.0
var base_position := Vector2.ZERO
var base_scale := Vector2.ONE

func configure(sprite: Sprite2D, state: Dictionary) -> void:
	sprite.region_rect = state.crop
	var scale_value := float(state.scale)
	base_scale = Vector2(scale_value, scale_value)
	sprite.scale = base_scale
	sprite.position = _center_sprite(sprite.region_rect.size * scale_value)
	base_position = sprite.position

func tick(sprite: Sprite2D, shadow: Polygon2D, state: Dictionary, moving: bool, paused: bool, delta: float) -> void:
	phase += delta
	var animation_name := String(state.animation)
	var bob := 0.0
	var sway := 0.0
	var squash := 1.0
	var stretch := 1.0
	var shadow_scale := Vector2.ONE

	if not paused:
		match animation_name:
			"trot":
				bob = sin(phase * 11.0) * 4.5
				sway = sin(phase * 5.5) * 1.5
				squash = 1.0 + sin(phase * 11.0) * 0.018
				stretch = 1.0 - sin(phase * 11.0) * 0.012
				shadow_scale = Vector2(1.0 + abs(sin(phase * 11.0)) * 0.05, 1.0)
			"puzzled":
				sway = sin(phase * 2.1) * 2.2
				bob = sin(phase * 1.4) * 1.0
			"sleepy":
				bob = sin(phase * 1.2) * 1.4
				stretch = 1.0 + sin(phase * 1.2) * 0.018
			"sentinel":
				sway = sin(phase * 1.7) * 0.8
				bob = sin(phase * 2.0) * 0.9
			"celebrate":
				bob = -abs(sin(phase * 7.0)) * 9.0
				sway = sin(phase * 10.0) * 2.0
				shadow_scale = Vector2(0.92 + abs(sin(phase * 7.0)) * 0.12, 1.0)
			"stretch":
				stretch = 1.0 + sin(phase * 2.8) * 0.025
				squash = 1.0 - sin(phase * 2.8) * 0.018
				bob = sin(phase * 1.5) * 1.0
			"cozy":
				bob = sin(phase * 1.0) * 1.0
				stretch = 1.0 + sin(phase * 1.0) * 0.012
			_:
				sway = sin(phase * 3.0) * 1.5
				bob = sin(phase * 2.4) * 2.0

	if moving and not paused:
		bob += sin(phase * 8.0) * 2.5

	sprite.position = base_position + Vector2(sway, bob)
	sprite.scale = Vector2(base_scale.x * squash, base_scale.y * stretch)
	shadow.scale = shadow_scale

func _center_sprite(display_size: Vector2) -> Vector2:
	return Vector2((320.0 - display_size.x) * 0.5, 228.0 - display_size.y)
