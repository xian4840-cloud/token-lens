/**
 * 主进程（electron/）与界面（ui/）共用的数据结构，唯一定义处。
 * 只放类型，不 import electron / DOM / node 模块，两边的构建都能直接编译。
 */
export type * from "./app";
export type * from "./local-usage";
export type * from "./model-monitor";
export type * from "./pet";
export type * from "./service";
