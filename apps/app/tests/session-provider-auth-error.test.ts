import { describe, expect, test } from "bun:test"
import { presentOpencodeSessionError } from "../src/react-app/domains/session/sync/session-error"
import { mapV2SessionError } from "../src/app/lib/opencode-v2-adapter"

const requestId = "req_01j-gateway-auth"

test("native v2 preserves an expired key response and explains that signing in cannot renew it", () => {
  const native = { type: "provider.auth", status: 401, message: "This API key has expired. Create a new API key in OpenCode Console.", response: { body: JSON.stringify({ error: { code: "api_key_expired", message: "This API key has expired." } }) } }
  const mapped = mapV2SessionError(native)
  expect(mapped.data).toMatchObject({ statusCode: 401, responseBody: native.response.body })
  const presentation = presentOpencodeSessionError(mapped)
  expect(presentation.kind).toBe("provider-credentials")
  expect(presentation.title).toBe("La clave de API está vencida")
  expect(presentation.description).toContain("no renueva esta clave")
})

function gatewayFailure(code: "provider_authentication_failed" | "provider_permission_denied", message: string) {
  return {
    name: "APIError",
    data: {
      statusCode: code === "provider_authentication_failed" ? 401 : 403,
      message,
      responseHeaders: { "x-openwork-request-id": requestId },
      responseBody: JSON.stringify({ error: {
        source: "openwork_gateway", code, message, provider_id: "ipr_fixture",
      } }),
    },
  }
}

describe("AI Gateway provider credential failures", () => {
  test("shows organization-admin action and a copyable request ID after a rejected org credential", () => {
    const presentation = presentOpencodeSessionError(gatewayFailure(
      "provider_authentication_failed",
      "Acme rejected your organization's API credential. Ask your administrator to check the Acme connection in AI Gateway.",
    ))
    expect(presentation.kind).toBe("gateway-provider-authentication-failed")
    expect(presentation.description).toBe("Acme rejected your organization's API credential. Ask your administrator to check the Acme connection in AI Gateway.")
    expect(presentation.technicalDetails).toContain(`Request ID: ${requestId}`)
    expect(presentation.connectUrl).toBeUndefined()
  })

  test("classifies a provider permission denial without offering local provider settings", () => {
    const presentation = presentOpencodeSessionError(gatewayFailure(
      "provider_permission_denied",
      "Acme denied access for your organization's provider credential. Ask your administrator to check the Acme connection in AI Gateway.",
    ))
    expect(presentation.kind).toBe("gateway-provider-permission-denied")
    expect(presentation.description).toContain("Ask your administrator")
    expect(presentation.connectUrl).toBeUndefined()
  })

  test("leaves personal-provider API key copy unchanged", () => {
    const presentation = presentOpencodeSessionError({
      name: "APIError",
      data: { statusCode: 401, message: "Invalid API key", responseBody: JSON.stringify({ error: { message: "Invalid API key", code: "invalid_api_key" } }) },
    })
    expect(presentation.kind).toBe("provider-credentials")
    expect(presentation.title).toBe("Your API key wasn’t accepted")
    expect(presentation.description).toBe("Check or replace your API key in model settings.")
  })
})
