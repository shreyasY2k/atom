package apierr

import "github.com/gofiber/fiber/v3"

// LiteLLM returns an OpenAI/LiteLLM-compatible error envelope so that
// guardrail and policy rejections from GATE are handled gracefully by any
// OpenAI-compatible client (including atom-studio and atom-sdk agents).
//
// Shape: { "error": { "message": "...", "type": "...", "param": null, "code": "..." } }
func LiteLLM(message, errType, code string) fiber.Map {
	return fiber.Map{
		"error": fiber.Map{
			"message": message,
			"type":    errType,
			"param":   nil,
			"code":    code,
		},
	}
}
