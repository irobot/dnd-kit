import {batch, reactive, untracked} from '@dnd-kit/state';
import {CollisionPriority} from '@dnd-kit/abstract';
import type {
  Data,
  PluginConstructor,
  Type,
  UniqueIdentifier,
} from '@dnd-kit/abstract';
import {
  defaultCollisionDetection,
  type CollisionDetector,
} from '@dnd-kit/collision';
import {Draggable, Droppable} from '@dnd-kit/dom';
import type {
  DraggableInput,
  FeedbackType,
  DroppableInput,
  Sensors,
  DragDropManager,
} from '@dnd-kit/dom';
import {animateTransform, scheduler} from '@dnd-kit/dom/utilities';
import {Shape} from '@dnd-kit/geometry';

import {SortableKeyboardPlugin} from './SortableKeyboardPlugin.ts';
import {OptimisticSortingPlugin} from './OptimisticSortingPlugin.ts';

export interface SortableTransition {
  /**
   * The duration of the transition in milliseconds.
   * @default 300
   */
  duration?: number;
  /**
   * The easing function to use for the transition.
   * @default 'cubic-bezier(0.25, 1, 0.5, 1)'
   */
  easing?: string;
  /**
   * Whether the sortable item should transition when its index changes,
   * but there is no drag operation in progress.
   * @default false
   **/
  idle?: boolean;
}

const defaultPlugins: PluginConstructor[] = [
  SortableKeyboardPlugin,
  OptimisticSortingPlugin,
];

export interface SortableInput<T extends Data>
  extends DraggableInput<T>,
    DroppableInput<T> {
  /**
   * The index of the sortable item within its group.
   */
  index: number;
  /**
   * The optional unique identifier of the group that the sortable item belongs to.
   */
  group?: UniqueIdentifier;
  /**
   * The transition configuration to use when the index of the sortable item changes.
   */
  transition?: SortableTransition | null;
  /**
   * Plugins to register when sortable item is instantiated.
   * @default [SortableKeyboardPlugin, OptimisticSortingPlugin]
   */
  plugins?: PluginConstructor[];
}

export const defaultSortableTransition: SortableTransition = {
  duration: 250,
  easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
  idle: false,
};

export class Sortable<T extends Data = Data> {
  public draggable: Draggable<T>;
  public droppable: Droppable<T>;

  @reactive
  index: number;

  previousIndex: number;

  initialIndex: number;

  @reactive
  group: UniqueIdentifier | undefined;

  transition: SortableTransition | null;

  constructor(
    {
      effects: inputEffects = () => [],
      group,
      index,
      sensors,
      type,
      transition = defaultSortableTransition,
      plugins = defaultPlugins,
      ...input
    }: SortableInput<T>,
    public manager: DragDropManager<any, any>
  ) {
    this.droppable = new SortableDroppable<T>(input, manager, this);
    this.draggable = new SortableDraggable<T>(
      {
        ...input,
        effects: () => [
          () =>
            this.manager.monitor.addEventListener('dragstart', () => {
              this.initialIndex = this.index;
              this.previousIndex = this.index;
            }),
          () => {
            const {index, previousIndex} = this;

            // Re-run this effect whenever the index changes
            if (index === previousIndex) {
              return;
            }

            this.previousIndex = index;

            this.animate();
          },
          () => {
            const {target} = this;
            const {feedback, isDragSource} = this.draggable;

            if (feedback == 'move' && isDragSource) {
              this.droppable.disabled = !target;
            }
          },
          ...inputEffects(),
        ],
        type,
        sensors,
      },
      manager,
      this
    );

    for (const plugin of plugins) {
      manager.registry.register(plugin);
    }

    this.index = index;
    this.previousIndex = index;
    this.initialIndex = index;
    this.group = group;
    this.type = type;
    this.transition = transition;

    this.destroy = () => {
      this.draggable.destroy();
      this.droppable.destroy();
    };
  }

  protected animate() {
    untracked(() => {
      const {manager, transition} = this;
      const {shape} = this.droppable;
      const {idle} = manager.dragOperation.status;

      if (!shape || !transition || (idle && !transition.idle)) {
        return;
      }

      scheduler.schedule(() => {
        const {element} = this.droppable;

        if (!element) {
          return;
        }

        this.refreshShape();

        const updatedShape = this.droppable.shape;

        if (!updatedShape) {
          return;
        }

        const delta = {
          x: shape.boundingRectangle.left - updatedShape.boundingRectangle.left,
          y: shape.boundingRectangle.top - updatedShape.boundingRectangle.top,
        };

        if (delta.x || delta.y) {
          animateTransform({
            element,
            keyframes: {
              translate: [`${delta.x}px ${delta.y}px 0`, '0px 0px 0'],
            },
            options: transition,
            onFinish: () => {
              if (idle) {
                this.droppable.shape = undefined;
              }
            },
          });
        }
      });
    });
  }

  public set element(element: Element | undefined) {
    this.draggable.element = element;
    this.droppable.element = element;
  }

  public get element() {
    return this.droppable.element ?? this.draggable.element;
  }

  public set target(target: Element | undefined) {
    this.droppable.element = target;
  }

  public get target() {
    return this.droppable.element;
  }

  public set source(source: Element | undefined) {
    this.draggable.element = source;
  }

  public get source() {
    return this.draggable.element;
  }

  public get disabled() {
    return this.draggable.disabled && this.droppable.disabled;
  }

  public set feedback(value: FeedbackType) {
    this.draggable.feedback = value;
  }

  public set disabled(value: boolean) {
    batch(() => {
      this.draggable.disabled = value;
      this.droppable.disabled = value;
    });
  }

  public set data(data: T | null) {
    batch(() => {
      this.draggable.data = data;
      this.droppable.data = data;
    });
  }

  public set handle(handle: Element | undefined) {
    this.draggable.handle = handle;
  }

  public set id(id: UniqueIdentifier) {
    batch(() => {
      this.draggable.id = id;
      this.droppable.id = id;
    });
  }

  public get id() {
    return this.droppable.id;
  }

  public set sensors(value: Sensors | undefined) {
    this.draggable.sensors = value;
  }

  public set collisionPriority(value: CollisionPriority | number | undefined) {
    this.droppable.collisionPriority = value ?? CollisionPriority.Normal;
  }

  public set collisionDetector(value: CollisionDetector | undefined) {
    this.droppable.collisionDetector = value ?? defaultCollisionDetection;
  }

  public set type(type: Type | undefined) {
    this.draggable.type = type;
    this.droppable.type = type;
  }

  public get type() {
    return this.draggable.type;
  }

  public set accept(value: Droppable['accept']) {
    this.droppable.accept = value;
  }

  public get accept() {
    return this.droppable.accept;
  }

  public get isDropTarget() {
    return this.droppable.isDropTarget;
  }

  /**
   * A boolean indicating whether the sortable item is the source of a drag operation.
   */
  public get isDragSource() {
    return this.draggable.isDragSource;
  }

  public refreshShape(ignoreTransforms = true) {
    this.droppable.refreshShape(ignoreTransforms);
  }

  public accepts(draggable: Draggable): boolean {
    return this.droppable.accepts(draggable);
  }

  public destroy() {}
}

export class SortableDraggable<T extends Data> extends Draggable<T> {
  constructor(
    input: DraggableInput<T>,
    manager: DragDropManager,
    public sortable: Sortable<T>
  ) {
    super(input, manager);
  }

  public get index() {
    return this.sortable.index;
  }
}

export class SortableDroppable<T extends Data> extends Droppable<T> {
  constructor(
    input: DraggableInput<T>,
    manager: DragDropManager,
    public sortable: Sortable<T>
  ) {
    super(input, manager);
  }

  public refreshShape(ignoreTransforms = true): Shape | undefined {
    return super.refreshShape(ignoreTransforms);
  }

  public get index() {
    return this.sortable.index;
  }
}