import { describe, expect, it, vi } from "vitest";
import { Color, Vector } from "@graphif/data-structures";
import { SymmetryCurve } from "@graphif/shapes";
import type { Project } from "@/core/Project";
import type { LineEdge } from "@/core/stage/stageObject/association/LineEdge";

vi.mock("@/core/Project", () => ({ Project: class {}, service: () => (value: unknown) => value }));
vi.mock("@/core/service/Settings", () => ({ Settings: { enableCollisionBoxAutoWidth: true, watch: vi.fn() } }));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/CircleFlameEffect", () => ({
  CircleFlameEffect: class {},
}));
vi.mock("@/core/service/feedbackService/effectEngine/concrete/LineCuttingEffect", () => ({
  LineCuttingEffect: class {},
}));
vi.mock("@/core/render/canvas2d/entityRenderer/edge/EdgeRendererClass", () => ({ EdgeRendererClass: class {} }));
vi.mock("@/core/render/svg/SvgUtils", () => ({ SvgUtils: {} }));
vi.mock("@/core/stage/stageObject/association/Edge", () => ({ Edge: class {} }));
vi.mock("@/core/stage/stageObject/association/ArcEdge", () => ({ ArcEdge: class {} }));
vi.mock("@/core/stage/stageObject/association/LineEdge", () => ({ LineEdge: class {} }));
vi.mock("@/core/stage/stageObject/association/CubicCatmullRomSplineEdge", () => ({
  CubicCatmullRomSplineEdge: class {},
}));
vi.mock("./StraightEdgeRenderer", () => ({ StraightEdgeRenderer: class {} }));
vi.mock("./VerticalPolyEdgeRenderer", () => ({ VerticalPolyEdgeRenderer: class {} }));
vi.mock("../renderCrEdge", () => ({ renderCrEdge: vi.fn() }));
vi.mock("../renderArcEdge", () => ({ renderArcEdge: vi.fn() }));
vi.mock("@/core/stage/stageObject/entity/ConnectPoint", () => ({ ConnectPoint: class {} }));
vi.mock("@/core/stage/stageObject/entity/Section", () => ({ Section: class {} }));
vi.mock("@/core/stage/stageObject/entity/ImageNode", () => ({ ImageNode: class {} }));
vi.mock("@/core/stage/stageObject/entity/TextNode", () => ({ TextNode: class {} }));

import { SymmetryCurveEdgeRenderer } from "./SymmetryCurveEdgeRenderer";
import { EdgeRenderer } from "../EdgeRenderer";

it("replaces the curve label with the editor at the same position and zoom", () => {
  const positionEditor = vi.fn(() => false);
  const draw = vi.fn();
  const project = {
    camera: { currentScale: 2 },
    renderer: { transformWorld2View: (point: Vector) => point.multiply(2).add(new Vector(10, 20)) },
    controllerUtils: { positionEdgeEditor: positionEditor },
    textRenderer: { renderMultiLineTextFromCenterWithStroke: draw },
    stageStyleManager: { currentStyle: { Background: Color.Black } },
  } as unknown as Project;
  project.edgeRenderer = new EdgeRenderer(project);
  const renderer = new SymmetryCurveEdgeRenderer(project) as unknown as {
    renderText(curve: SymmetryCurve, edge: LineEdge): void;
  };
  const curve = new SymmetryCurve(new Vector(0, 0), new Vector(0, 1), new Vector(80, 20), new Vector(0, 1));
  const edge = { uuid: "edge", text: "标签", textFontSize: 18, color: Color.Red } as LineEdge;
  const center = project.renderer.transformWorld2View(curve.bezier.getPointByT(0.5));
  renderer.renderText(curve, edge);
  expect(draw).toHaveBeenCalledExactlyOnceWith(edge.text, center, 36, Color.Red, Color.Black);

  draw.mockClear();
  positionEditor.mockReturnValue(true);
  renderer.renderText(curve, edge);
  expect(positionEditor).toHaveBeenLastCalledWith(edge.uuid, center, 36, Color.Red);
  expect(draw).not.toHaveBeenCalled();
});

describe("curve hover highlight", () => {
  it.each(
    ["default", "hollow-triangle", "filled-triangle", "hollow-diamond", "filled-diamond"].flatMap((arrowType) =>
      [false, true].map((warning) => ({ arrowType, warning })),
    ),
  )("uses rendered geometry for $arrowType arrows (cutting: $warning)", ({ arrowType, warning }) => {
    const draw = vi.fn();
    const edge = { uuid: "edge", arrowType, lineType: "solid", isSelected: true } as LineEdge;
    const project = {
      camera: { currentScale: 2, isDefaultZoom: () => false },
      mouseInteraction: { hoverEdges: warning ? [] : [{ uuid: "edge" }] },
      controller: { cutting: { warningAssociations: warning ? [edge] : [] } },
      stageStyleManager: {
        currentStyle: {
          CollideBoxSelected: Color.White,
          CollideBoxPreSelected: Color.Red,
          effects: { warningShadow: Color.Red },
        },
      },
      worldRenderUtils: { renderSymmetryCurve: draw },
      edgeRenderer: { renderArrowByType: vi.fn() },
    } as unknown as Project;
    const renderer = new SymmetryCurveEdgeRenderer(project) as unknown as {
      renderArrowCurve: (curve: SymmetryCurve, color: Color, width: number, edge: LineEdge) => void;
    };
    renderer.renderArrowCurve(
      new SymmetryCurve(new Vector(0, 0), new Vector(1, 0), new Vector(100, 30), new Vector(-1, 0), 50),
      Color.White,
      2,
      edge,
    );
    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw.mock.calls[0][0]).toBe(draw.mock.calls[1][0]);
    expect(draw.mock.calls[0][1]).toEqual(Color.Red.toNewAlpha(0.35));
    expect(draw.mock.calls[1][1]).toBe(Color.White);
    expect(draw.mock.calls[0][2]).toBe(8);
    expect(draw.mock.calls[1][2]).toBe(4);
  });
});
