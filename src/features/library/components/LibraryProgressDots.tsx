import { useEffect, useRef, useState } from "react";
import DotMatrix from "../../../shared/ui/DotMatrix";
import { buildProgressDots, clampProgress, type LibraryProgressDotsProps } from "./library-utils";

const LibraryProgressDots = ({ progress, status }: LibraryProgressDotsProps) => {
    const cols = 40;
    const rows = 2;
    const color = status === "importing" ? "var(--color-accent)" : "var(--color-cloud)";
    const [displayProgress, setDisplayProgress] = useState(() => clampProgress(progress));
    const displayProgressRef = useRef(displayProgress);
    const targetProgress = clampProgress(progress);

    useEffect(() => {
        displayProgressRef.current = displayProgress;
    }, [displayProgress]);

    useEffect(() => {
        if (targetProgress <= displayProgressRef.current) {
            setDisplayProgress(targetProgress);
            return;
        }

        let rafId = 0;
        const tick = () => {
            const current = displayProgressRef.current;
            const delta = targetProgress - current;
            if (delta <= 0.001) {
                setDisplayProgress(targetProgress);
                return;
            }
            const next = current + delta * 0.2;
            setDisplayProgress(next);
            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [targetProgress]);

    return (
        <DotMatrix
            rows={rows}
            cols={cols}
            activeDots={buildProgressDots(displayProgress, cols, rows)}
            dotSize={2}
            gap={2}
            color={color}
            className="opacity-60"
        />
    );
};

export default LibraryProgressDots;
