const source = { path: "M3-test/MovieObject.bdmv", origin: "primary", offset: "128" } as const;

function command(opCount: number, group: number, subGroup: number, imm1: boolean, imm2: boolean, branch: number, compare: number, set: number, w1: number, w2 = 0) {
  const w0 = (((opCount & 7) << 29) | ((group & 3) << 27) | ((subGroup & 7) << 24) | (Number(imm1) << 23) | (Number(imm2) << 22) | ((branch & 15) << 16) | ((compare & 15) << 8) | (set & 31)) >>> 0;
  const words: [number, number, number] = [w0, w1 >>> 0, w2 >>> 0];
  const bytes = words.map((x) => x.toString(16).padStart(8, "0")).join("");
  return { words, bytes, source };
}

export const m3Fixtures = {
  move5: command(2, 2, 0, false, true, 0, 0, 1, 0, 5),
  move1: command(2, 2, 0, false, true, 0, 0, 1, 0, 1),
  moveGpr1ToGpr0: command(2, 2, 0, false, false, 0, 0, 1, 0, 1),
  add7: command(2, 2, 0, false, true, 0, 0, 3, 0, 7),
  compareEq7: command(2, 1, 0, false, true, 0, 2, 0, 0, 7),
  callObject1: command(1, 0, 1, true, false, 2, 0, 0, 1),
  callObjectGpr0: command(1, 0, 1, false, false, 2, 0, 0, 0),
  jumpObject1: command(1, 0, 1, true, false, 0, 0, 0, 1),
  goto0: command(1, 0, 0, true, false, 1, 0, 0, 0),
  goto1: command(1, 0, 0, true, false, 1, 0, 0, 1),
  playPlaylist42: command(1, 0, 2, true, false, 0, 0, 0, 42),
  playPlaylist1: command(1, 0, 2, true, false, 0, 0, 0, 1),
  playPlaylistGpr0: command(1, 0, 2, false, false, 0, 0, 0, 0),
  callTitle0: command(1, 0, 1, true, false, 3, 0, 0, 0),
  callTitleGpr0: command(1, 0, 1, false, false, 3, 0, 0, 0),
  jumpTitle1: command(1, 0, 1, true, false, 1, 0, 0, 1),
  jumpTitleGpr0: command(1, 0, 1, false, false, 1, 0, 0, 0),
  jumpTitleGpr1: command(1, 0, 1, false, false, 1, 0, 0, 1),
  linkPlayItem3: command(1, 0, 2, true, false, 4, 0, 0, 3),
  resume: command(0, 0, 1, false, false, 4, 0, 0, 0),
  terminatePlaylist: command(0, 0, 2, false, false, 3, 0, 0, 0),
  popupOff: command(0, 2, 1, false, false, 0, 0, 7, 0),
  break: command(0, 0, 0, false, false, 2, 0, 0, 0),
  unknown: command(1, 0, 7, true, false, 0, 0, 0, 9),
};
