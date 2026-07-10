// Penalty444 — Unity WebGL browser message bridge (Phase B4).
//
// Presentation-only. Registers exactly ONE window "message" listener that
// accepts only strictly same-origin, same-parent PENALTY444_MATCH_EVENT
// envelopes and forwards them to the UnityBridgeReceiver C# component via
// SendMessage. After registration it posts a single PENALTY444_UNITY_EVENT
// "ready" back to the parent.
//
// Non-negotiable: it opens NO network connection and reads NO cookies /
// localStorage / auth data / tokens / env secrets. It never computes results,
// never submits picks, and never carries authority.

mergeInto(LibraryManager.library, {
  // Called from C# (UnityBridgeReceiver.Start) with the receiver GameObject's
  // name, so we target it via SendMessage without a hard-coded scene name.
  Penalty444RegisterWebBridge: function (goNamePtr) {
    var goName = UTF8ToString(goNamePtr);

    // Prevent duplicate listener registration (e.g. re-init / domain reload).
    if (window.__penalty444BridgeRegistered) {
      return;
    }
    window.__penalty444BridgeRegistered = true;

    var expectedOrigin = window.location.origin;

    var handler = function (e) {
      // Strict inbound validation: same-origin AND from the embedding parent.
      if (e.origin !== expectedOrigin) return;
      if (e.source !== window.parent) return;

      var data = e.data;
      if (!data || data.type !== "PENALTY444_MATCH_EVENT") return;

      // Forward the complete envelope as JSON to the C# receiver. Never throw
      // out of the listener — malformed input must not break the page.
      try {
        var json = JSON.stringify(data);
        if (typeof SendMessage === "function") {
          SendMessage(goName, "OnWebMessage", json);
        } else if (
          typeof Module !== "undefined" &&
          typeof Module.SendMessage === "function"
        ) {
          Module.SendMessage(goName, "OnWebMessage", json);
        }
      } catch (err) {
        /* swallow — presentation bridge must stay non-fatal */
      }
    };

    window.addEventListener("message", handler);
    // Keep a reference so the unregister path can remove exactly this listener.
    window.__penalty444BridgeHandler = handler;

    // Tell the parent the bridge is live and Unity can receive events.
    try {
      window.parent.postMessage(
        { type: "PENALTY444_UNITY_EVENT", event: "ready", payload: null },
        expectedOrigin
      );
    } catch (err) {
      /* parent may be gone; ignore */
    }
  },

  // Optional cleanup — removes the listener and clears the registration flag.
  Penalty444UnregisterWebBridge: function () {
    if (window.__penalty444BridgeHandler) {
      window.removeEventListener("message", window.__penalty444BridgeHandler);
      window.__penalty444BridgeHandler = null;
    }
    window.__penalty444BridgeRegistered = false;
  },
});
