import type { Entity } from "@/core/stage/stageObject/abstract/StageEntity";
import type { Section } from "@/core/stage/stageObject/entity/Section";

export function getLayoutItem<T extends Entity>(entity: T, scope: Section | null): T | Section | undefined {
  const item: Entity = entity;
  if (item === scope) return;
  if ((entity.parentSection ?? null) === scope) return entity;
  for (let section = entity.parentSection; section && section !== scope; section = section.parentSection) {
    if (section.parentSection === scope) return section;
  }
}

export function getLayoutScope(entities: readonly Entity[]): Section | null {
  let scope = entities[0]?.parentSection ?? null;
  for (const entity of entities) {
    while (scope && !getLayoutItem(entity, scope)) scope = scope.parentSection;
    if (!scope) break;
  }
  return scope;
}
