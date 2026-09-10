import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import idleSprite from "@/assets/pet/idle.png";
import blinkSprite from "@/assets/pet/blink.png";
import workingSprite from "@/assets/pet/working.png";
import waveSprite from "@/assets/pet/wave.png";
import lookSprite from "@/assets/pet/look.png";
import hopSprite from "@/assets/pet/hop.png";
import { ipc } from "@/lib/ipc";
import { formatMoney, formatTokensCn } from "@/lib/format";
import { LOCAL_SOURCE_LABEL } from "@/lib/local-sources";
import type { PetActivity, PetSpendSummary } from "@/types";

const CLICK_SLOP_PX = 6;

type PetPose = "idle" | "blink" | "wave" | "look" | "hop";

const POSE_SPRITE: Record<PetPose, string> = {
  idle: idleSprite,
  blink: blinkSprite,
  wave: waveSprite,
  look: lookSprite,
  hop: hopSprite,
};

const POSE_MS: Record<PetPose, number> = {
  idle: 0,
  blink: 180,
  wave: 900,
  look: 1200,
  hop: 720,
};

function nextIdlePose(): PetPose {
  const roll = Math.random();
  if (roll < 0.38) return "blink";
  if (roll < 0.58) return "wave";
  if (roll < 0.78) return "look";
  return "hop";
}

export function PetPage() {
  const [activity, setActivity] = useState<PetActivity>({ status: "idle" });
  const [pose, setPose] = useState<PetPose>("idle");
  const [showSpend, setShowSpend] = useState(false);
  const [spend, setSpend] = useState<PetSpendSummary | null>(null);
  const [loadingSpend, setLoadingSpend] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const drag = useRef({ down: false, moved: false, x: 0, y: 0 });
  const showSpendRef = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add("pet-window");
    document.body.classList.add("pet-window");
    return () => {
      document.documentElement.classList.remove("pet-window");
      document.body.classList.remove("pet-window");
    };
  }, []);

  useEffect(() => {
    void ipc.getPetActivity().then(setActivity);
    const offActivity = ipc.onPetActivity(setActivity);
    const offSpend = ipc.onPetSpendUpdated((summary) => {
      setSpend(summary);
      setLoadingSpend(false);
    });
    return () => {
      offActivity();
      offSpend();
    };
  }, []);

  useEffect(() => {
    if (!loadingSpend) return;
    const t = window.setTimeout(() => setLoadingSpend(false), 8000);
    return () => window.clearTimeout(t);
  }, [loadingSpend]);

  useEffect(() => {
    if (activity.status !== "idle") {
      setPose("idle");
      return;
    }
    let wait = 0;
    let hold = 0;
    let cancelled = false;
    const rest = () => {
      if (cancelled) return;
      setPose("idle");
      wait = window.setTimeout(() => {
        if (cancelled) return;
        const next = nextIdlePose();
        setPose(next);
        hold = window.setTimeout(rest, POSE_MS[next]);
      }, 1800 + Math.random() * 2800);
    };
    rest();
    return () => {
      cancelled = true;
      window.clearTimeout(wait);
      window.clearTimeout(hold);
    };
  }, [activity.status]);

  const loadSpend = useCallback(async () => {
    setLoadingSpend(true);
    try {
      const summary = await ipc.petTodaySpend();
      setSpend(summary);
      if (summary.tokens > 0 || summary.cost != null) setLoadingSpend(false);
    } catch {
      setLoadingSpend(false);
    }
  }, []);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { down: true, moved: false, x: e.screenX, y: e.screenY };
    setGrabbing(true);
    ipc.petDragStart();
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current.down) return;
    if (!drag.current.moved) {
      const dx = e.screenX - drag.current.x;
      const dy = e.screenY - drag.current.y;
      if (dx * dx + dy * dy >= CLICK_SLOP_PX * CLICK_SLOP_PX) {
        drag.current.moved = true;
      }
    }
    if (drag.current.moved) ipc.petDragMove();
  };

  const handlePointerUp = () => {
    if (!drag.current.down) return;
    const wasClick = !drag.current.moved;
    drag.current.down = false;
    setGrabbing(false);
    ipc.petDragEnd();
    if (!wasClick) return;
    if (showSpendRef.current) {
      showSpendRef.current = false;
      setShowSpend(false);
      return;
    }
    showSpendRef.current = true;
    setShowSpend(true);
    void loadSpend();
  };

  const working = activity.status === "working";
  const sprite = working ? workingSprite : POSE_SPRITE[pose];
  const poseClass = working
    ? "pet-bob-work"
    : pose === "hop"
      ? "pet-act-hop"
      : pose === "look"
        ? "pet-act-look"
        : pose === "wave"
          ? "pet-act-wave"
          : "pet-bob-idle";
  const sourceLabel = activity.source
    ? LOCAL_SOURCE_LABEL[activity.source]
    : undefined;

  return (
    <div
      className={`relative h-full w-full select-none overflow-hidden ${grabbing ? "cursor-grabbing" : "cursor-grab"}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        if (drag.current.down) ipc.petDragEnd();
        drag.current.down = false;
        setGrabbing(false);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {showSpend && (
        <div className="absolute left-1/2 top-1 z-10 w-[164px] -translate-x-1/2 rounded-xl border border-white/60 bg-[rgba(252,248,238,0.94)] px-2.5 py-2 text-[#463e30] shadow-[0_8px_24px_rgba(70,62,48,0.18)] backdrop-blur-md">
          <p className="text-[10px] tracking-wide text-[#8b8171]">今日 agent</p>
          <p className="font-display text-base font-medium tabular">
            {loadingSpend && (spend == null || spend.tokens === 0)
              ? "正在统计…"
              : formatMoney(spend?.cost ?? undefined, spend?.currency ?? "USD")}
          </p>
          {spend && spend.tokens > 0 && (
            <p className="text-[10px] text-[#8b8171]">
              {formatTokensCn(spend.tokens)} tokens
              {spend.hasUnpriced ? " · 部分未标价" : ""}
            </p>
          )}
          {spend && spend.bySource.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[10px] text-[#5a5142]">
              {spend.bySource.map((s) => (
                <li key={s.source} className="flex justify-between gap-2">
                  <span>{s.label}</span>
                  <span className="tabular">
                    {s.cost != null ? formatMoney(s.cost, spend.currency) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {spend && spend.tokens === 0 && !loadingSpend && (
            <p className="text-[10px] text-[#8b8171]">今天还没有用量</p>
          )}
        </div>
      )}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <div className={poseClass}>
          <img
            src={sprite}
            alt=""
            draggable={false}
            className="pointer-events-none h-[196px] w-auto"
          />
        </div>
      </div>

      {working && (
        <div className="absolute bottom-1 left-1/2 max-w-[160px] -translate-x-1/2 truncate rounded-full bg-[rgba(252,248,238,0.9)] px-2 py-0.5 text-center text-[10px] text-[#5a5142] shadow-sm">
          {sourceLabel ? `${sourceLabel} 工作中` : "工作中"}
        </div>
      )}
    </div>
  );
}
