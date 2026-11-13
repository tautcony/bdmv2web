/** Shared synthetic input/action sequence for M4 and M5 playback bridges. */
export const menuInteractionFixture = {
  id: "m4-m5-menu-interaction-v1",
  scene: {
    width: 100,
    height: 60,
    pages: [{
      id: 0,
      uoMask: "0",
      defaultButtonId: 1,
      bogDefaults: [{ bog: 0, defaultButtonId: 1 }],
      buttons: [
        {
          id: 1,
          bog: 0,
          enabled: true,
          neighbors: { up: 1, down: 1, left: 1, right: 2 },
          states: {
            normal: { bounds: { x: 10, y: 10, width: 20, height: 20 } },
            selected: { bounds: { x: 10, y: 10, width: 20, height: 20 } },
            activated: { bounds: { x: 10, y: 10, width: 20, height: 20 } },
          },
          commands: [],
        },
        {
          id: 2,
          bog: 0,
          enabled: true,
          neighbors: { up: 2, down: 2, left: 1, right: 2 },
          states: {
            normal: { bounds: { x: 40, y: 10, width: 20, height: 20 } },
            selected: { bounds: { x: 40, y: 10, width: 20, height: 20 } },
            activated: { bounds: { x: 40, y: 10, width: 20, height: 20 } },
          },
          // LINK_PI 3, hand-encoded as a raw 12-byte HDMV command.
          commands: [{ bytes: "228400000000000300000000" }],
        },
      ],
    }],
  },
  steps: [
    { input: "right", selectedButtonId: 2 },
    { input: "activate", actionType: "LINK_PLAY_ITEM", actionPayload: { playItem: 3 } },
  ],
  verification: {
    supported: ["synthetic menu focus and button action dispatch"],
  },
} as const;
