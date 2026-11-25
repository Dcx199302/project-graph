import { Vector } from "@graphif/data-structures";

export interface ControllerInputHandlers {
  down(event: PointerEvent): void;
  move(event: PointerEvent): void;
  /** 返回 true 时，这次松开不参与后续的单击和双击判断。 */
  up(event: PointerEvent): boolean | void;
  /** 单击另有用途时，等确认拖动后才派发按下事件。 */
  getClickAction(event: PointerEvent): (() => void) | undefined;
  middleClick(event: PointerEvent): boolean;
  doubleClick(event: PointerEvent): void;
  wheel(event: WheelEvent): void;
  keydown(event: KeyboardEvent): void;
  keyup(event: KeyboardEvent): void;
  touchstart(event: TouchEvent): void;
  touchmove(event: TouchEvent): void;
  touchend(event: TouchEvent): void;
  cancel(location: Vector): void;
}

/** DOM 输入只在这里归一化，业务控制器接收画布坐标。 */
export class ControllerInput {
  private press: {
    id: number;
    button: number;
    location: Vector;
    dragged: boolean;
    deferred?: { event: PointerEvent; click: () => void };
  } | null = null;
  private lastClick: { button: number; location: Vector; time: number } | null = null;
  private touchMode: "idle" | "single" | "multi" = "idle";
  private location = Vector.getZero();

  constructor(
    private readonly element: HTMLCanvasElement,
    private readonly clientToView: (x: number, y: number) => Vector,
    private readonly handlers: ControllerInputHandlers,
  ) {
    for (const [type, handler] of Object.entries(this.listeners))
      element.addEventListener(type, handler, { passive: false });
    window.addEventListener("blur", this.cancel);
  }

  private viewEvent<T extends PointerEvent | WheelEvent>(event: T): T {
    const point = this.clientToView(event.clientX, event.clientY);
    // 捏合的 deltaY 是缩放量，只有普通像素滚动需要转换坐标单位。
    const delta =
      "deltaMode" in event && event.deltaMode === 0 && !event.ctrlKey
        ? this.clientToView(event.deltaX, event.deltaY).subtract(this.clientToView(0, 0))
        : null;
    return new Proxy(event, {
      get(target, property) {
        if (property === "clientX") return point.x;
        if (property === "clientY") return point.y;
        if (delta && property === "deltaX") return delta.x;
        if (delta && property === "deltaY") return delta.y;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  private down(event: PointerEvent) {
    this.location = new Vector(event.clientX, event.clientY);
    const click = this.handlers.getClickAction(event);
    this.press = {
      id: event.pointerId,
      button: event.button,
      location: this.location,
      dragged: false,
      deferred: click ? { event, click } : undefined,
    };
    if (!click) this.handlers.down(event);
  }

  private move(event: PointerEvent) {
    this.location = new Vector(event.clientX, event.clientY);
    if (this.press && this.press.location.distance(this.location) > 5) this.press.dragged = true;
    if (this.press?.deferred) {
      if (!this.press.dragged) return;
      const { event } = this.press.deferred;
      this.press.deferred = undefined;
      this.handlers.down(event);
    }
    this.handlers.move(event);
  }

  private up(event: PointerEvent) {
    const press = this.press;
    this.press = null;
    this.location = new Vector(event.clientX, event.clientY);
    const isClick =
      press &&
      press.button === event.button &&
      event.buttons === 0 &&
      !press.dragged &&
      press.location.distance(this.location) <= 5;
    if (press?.deferred) {
      if (isClick) {
        this.lastClick = null;
        press.deferred.click();
        return;
      }
      this.handlers.down(press.deferred.event);
      this.handlers.move(event);
    }
    const consumed = this.handlers.up(event);
    if (consumed || !isClick) {
      this.lastClick = null;
      return;
    }
    if (event.button === 1 && this.handlers.middleClick(event)) {
      this.lastClick = null;
      return;
    }
    const time = event.timeStamp;
    if (
      this.lastClick &&
      this.lastClick.button === event.button &&
      time - this.lastClick.time < 300 &&
      this.lastClick.location.distance(this.location) < 5
    ) {
      this.lastClick = null;
      this.handlers.doubleClick(event);
    } else {
      this.lastClick = { button: event.button, location: this.location, time };
    }
  }

  private pointerdown = (event: PointerEvent) => {
    if (event.pointerType === "touch" || this.press) return;
    this.element.setPointerCapture(event.pointerId);
    this.down(this.viewEvent(event));
  };

  private pointermove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    if (this.press && this.press.id !== event.pointerId) return;
    if (this.press) {
      if (event.buttons === 0) {
        this.cancel();
        return;
      }
      if (event.pointerType === "mouse") {
        const buttonMask = [1, 4, 2, 8, 16][this.press.button];
        if (buttonMask && (event.buttons & buttonMask) === 0) {
          // 多键按下时，首个按键的松开可能由 pointermove 上报。
          if (event.button === this.press.button) this.pointerup(event);
          else this.cancel();
          return;
        }
        if ((event.buttons & (event.buttons - 1)) !== 0) this.press.dragged = true;
      }
    }
    this.move(this.viewEvent(event));
  };

  private pointerup = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    if (!this.press) return;
    if (this.press && this.press.id !== event.pointerId) return;
    if (this.press.button !== event.button) {
      this.cancel();
      return;
    }
    this.up(this.viewEvent(event));
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
  };

  private pointercancel = (event: PointerEvent) => {
    if (this.press?.id === event.pointerId) this.cancel();
  };

  private touchPointer(touch: Touch, type: string): PointerEvent {
    return this.viewEvent(
      new PointerEvent(type, {
        pointerType: "touch",
        pointerId: touch.identifier,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: touch.clientX,
        clientY: touch.clientY,
      }),
    );
  }

  private touchstart = (event: TouchEvent) => {
    event.preventDefault();
    if (event.touches.length > 1) {
      if (this.touchMode !== "multi") this.cancel();
      this.touchMode = "multi";
    } else if (this.touchMode === "idle" && event.touches.length === 1) {
      this.touchMode = "single";
      this.down(this.touchPointer(event.touches[0], "pointerdown"));
    }
    this.handlers.touchstart(event);
  };

  private touchmove = (event: TouchEvent) => {
    event.preventDefault();
    if (this.touchMode === "single" && event.touches.length === 1)
      this.move(this.touchPointer(event.touches[0], "pointermove"));
    this.handlers.touchmove(event);
  };

  private touchend = (event: TouchEvent) => {
    event.preventDefault();
    this.handlers.touchend(event);
    if (event.touches.length !== 0) return;
    if (this.touchMode === "single" && event.changedTouches.length > 0)
      this.up(this.touchPointer(event.changedTouches[0], "pointerup"));
    this.touchMode = "idle";
  };

  public cancel = () => {
    const pointerId = this.press?.id;
    this.press = null;
    this.lastClick = null;
    this.touchMode = "idle";
    if (pointerId !== undefined && this.element.hasPointerCapture(pointerId))
      this.element.releasePointerCapture(pointerId);
    this.handlers.cancel(this.location);
  };

  private readonly listeners: Record<string, EventListener> = {
    pointerdown: this.pointerdown as EventListener,
    pointermove: this.pointermove as EventListener,
    pointerup: this.pointerup as EventListener,
    pointercancel: this.pointercancel as EventListener,
    lostpointercapture: this.pointercancel as EventListener,
    mousedown: (event) => {
      if ((event as MouseEvent).button === 1) event.preventDefault();
    },
    touchstart: this.touchstart as EventListener,
    touchmove: this.touchmove as EventListener,
    touchend: this.touchend as EventListener,
    touchcancel: this.cancel,
    keydown: ((event: KeyboardEvent) => this.handlers.keydown(event)) as EventListener,
    keyup: ((event: KeyboardEvent) => this.handlers.keyup(event)) as EventListener,
    wheel: ((event: WheelEvent) => {
      event.preventDefault();
      this.handlers.wheel(this.viewEvent(event));
    }) as EventListener,
  };

  public dispose() {
    this.cancel();
    for (const [type, handler] of Object.entries(this.listeners)) this.element.removeEventListener(type, handler);
    window.removeEventListener("blur", this.cancel);
  }
}
