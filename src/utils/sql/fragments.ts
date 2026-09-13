import type { BuiltQuery, SqlValue } from "./types";

const FORBIDDEN_FRAGMENT_SEQUENCES = [";", "--", "/*"] as const;

export function assertStaticFragment(fragment: string): void {
  for (const sequence of FORBIDDEN_FRAGMENT_SEQUENCES) {
    if (fragment.includes(sequence)) {
      throw new Error(
        `Фрагмент SQL содержит запрещённую последовательность "${sequence}" — значения передаются через плейсхолдеры`,
      );
    }
  }
}

export interface WhereState {
  parts: string[];
  values: SqlValue[];
}

export function createWhereState(): WhereState {
  return { parts: [], values: [] };
}

export function addWhere(state: WhereState, condition: string, ...args: SqlValue[]): void {
  assertStaticFragment(condition);
  state.parts.push(condition);
  state.values.push(...args);
}

export function addAnd(state: WhereState, condition: string, ...args: SqlValue[]): void {
  assertStaticFragment(condition);
  if (state.parts.length > 0) {
    state.parts.push("AND");
  }
  state.parts.push(condition);
  state.values.push(...args);
}

export function buildWhereClause(state: WhereState): string {
  return state.parts.length > 0 ? ` WHERE ${state.parts.join(" ")}` : "";
}

export function buildWithWhere(baseSql: string, state: WhereState): BuiltQuery {
  return {
    sql: `${baseSql}${buildWhereClause(state)}`,
    values: state.values,
  };
}
