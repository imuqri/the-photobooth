// Layout definitions for the final exported photo.
// `stageAspect` is the aspect ratio (w/h) participants frame themselves
// into live — it matches each slot's aspect so what you see while
// dragging into place is exactly what gets captured.

const GAP = 18;
const MARGIN = 28;
const SPROCKET_ZONE = 26; // width reserved for film-strip perforations

function stripLayout() {
  const slotW = 560;
  const slotH = 420;
  const canvasWidth = slotW + MARGIN * 2 + SPROCKET_ZONE * 2;
  const footer = 90;
  const canvasHeight = MARGIN * 2 + slotH * 3 + GAP * 2 + footer;

  const slots = [0, 1, 2].map((i) => ({
    x: MARGIN + SPROCKET_ZONE,
    y: MARGIN + i * (slotH + GAP),
    w: slotW,
    h: slotH,
  }));

  return {
    id: "strip3",
    label: "3-Photo Strip",
    shotCount: 3,
    canvasWidth,
    canvasHeight,
    slots,
    slotAspect: slotW / slotH,
    sprocketZone: SPROCKET_ZONE,
    footerHeight: footer,
    style: "strip",
  };
}

function gridLayout() {
  const slotW = 520;
  const slotH = 390;
  const canvasWidth = MARGIN * 2 + slotW * 2 + GAP;
  const footer = 80;
  const canvasHeight = MARGIN * 2 + slotH * 2 + GAP + footer;

  const slots = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      slots.push({
        x: MARGIN + col * (slotW + GAP),
        y: MARGIN + row * (slotH + GAP),
        w: slotW,
        h: slotH,
      });
    }
  }

  return {
    id: "grid4",
    label: "4-Photo Grid",
    shotCount: 4,
    canvasWidth,
    canvasHeight,
    slots,
    slotAspect: slotW / slotH,
    sprocketZone: 0,
    footerHeight: footer,
    style: "grid",
  };
}

export const LAYOUTS = {
  strip3: stripLayout(),
  grid4: gridLayout(),
};
