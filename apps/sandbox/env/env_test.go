package env

import "testing"

func TestResolveSandboxVersion(t *testing.T) {
	t.Run("prefers Cohub version", func(t *testing.T) {
		t.Setenv("COHUB_SANDBOX_VERSION", " cohub-sandbox:current ")
		t.Setenv("IMAGE_VERSION", "cohub-sandbox:legacy")
		if got := ResolveSandboxVersion("fallback"); got != "cohub-sandbox:current" {
			t.Fatalf("ResolveSandboxVersion() = %q, want current version", got)
		}
	})

	t.Run("accepts legacy version", func(t *testing.T) {
		t.Setenv("COHUB_SANDBOX_VERSION", "")
		t.Setenv("IMAGE_VERSION", " cohub-sandbox:legacy ")
		if got := ResolveSandboxVersion("fallback"); got != "cohub-sandbox:legacy" {
			t.Fatalf("ResolveSandboxVersion() = %q, want legacy version", got)
		}
	})

	t.Run("uses fallback", func(t *testing.T) {
		t.Setenv("COHUB_SANDBOX_VERSION", "")
		t.Setenv("IMAGE_VERSION", "")
		if got := ResolveSandboxVersion("fallback"); got != "fallback" {
			t.Fatalf("ResolveSandboxVersion() = %q, want fallback", got)
		}
	})
}
