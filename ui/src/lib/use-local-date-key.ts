import { useEffect, useState } from "react";
import { localDateKey, msUntilNextLocalMidnight } from "./format";

/**
 * 本地「今天」的日期键。跨过零点会自己翻到新的一天，
 * 总览「今日本地 agent」不会把昨天的数一直当成今天。
 */
export function useLocalDateKey(): string {
  const [key, setKey] = useState(() => localDateKey());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        setKey(localDateKey());
        arm();
      }, msUntilNextLocalMidnight() + 50);
    };
    arm();
    return () => clearTimeout(timer);
  }, []);

  return key;
}
