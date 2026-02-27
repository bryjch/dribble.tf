/* tslint:disable */
/* eslint-disable */

export function parse_demo_cache(buffer: Uint8Array): any;

export function parse_demo_cache_window(buffer: Uint8Array, window_demo_start_tick: number, window_demo_end_tick: number): any;

export function parse_demo_cache_window_with_progress(buffer: Uint8Array, window_demo_start_tick: number, window_demo_end_tick: number, progress_callback: Function): any;

export function parse_demo_cache_with_progress(buffer: Uint8Array, progress_callback: Function): any;

export function parse_demo_player_trail(buffer: Uint8Array, target_entity_id: number, target_user_id: number, target_steam_id: string): any;

export function parse_demo_player_trail_with_progress(buffer: Uint8Array, target_entity_id: number, target_user_id: number, target_steam_id: string, progress_callback: Function): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly analyze_demo: (a: number) => number;
    readonly free_string: (a: number) => void;
    readonly parse_demo_cache: (a: number, b: number) => any;
    readonly parse_demo_cache_window: (a: number, b: number, c: number, d: number) => any;
    readonly parse_demo_cache_window_with_progress: (a: number, b: number, c: number, d: number, e: any) => any;
    readonly parse_demo_cache_with_progress: (a: number, b: number, c: any) => any;
    readonly parse_demo_player_trail: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly parse_demo_player_trail_with_progress: (a: number, b: number, c: number, d: number, e: number, f: number, g: any) => any;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
