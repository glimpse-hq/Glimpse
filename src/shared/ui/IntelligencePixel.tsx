import { motion } from "framer-motion";

interface IntelligencePixelProps {
    active: boolean;
    statusType?: string;
    size?: "sm" | "md" | "lg";
    className?: string;
}

export const IntelligencePixel = ({
    active,
    statusType = "pending",
    size = "sm",
    className = "",
}: IntelligencePixelProps) => {
    const isError = statusType === "error";
    const isComplete = statusType === "complete";

    const sizeMap = {
        sm: {
            container: "w-[10px] h-[10px] gap-[2px]",
            dot: "w-[4px] h-[4px] rounded-[1px]",
        },
        md: {
            container: "w-[20px] h-[20px] gap-[4px]",
            dot: "w-[8px] h-[8px] rounded-[2px]",
        },
        lg: {
            container: "w-[40px] h-[40px] gap-[8px]",
            dot: "w-[16px] h-[16px] rounded-[4px]",
        },
    };

    const currentSize = sizeMap[size];

    return (
        <div className={`grid grid-cols-2 shrink-0 ${currentSize.container} ${className}`}>
            {[0, 1, 2, 3].map((i) => (
                <motion.div
                    key={i}
                    animate={
                        active
                            ? { opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }
                            : { opacity: isComplete ? 0.8 : 0.3, scale: 1 }
                    }
                    transition={
                        active
                            ? { duration: 1.5, repeat: Infinity, delay: i * 0.2, ease: "easeInOut" }
                            : { duration: 0.3 }
                    }
                    className={`${currentSize.dot} ${
                        isError
                            ? "bg-[var(--color-error)]"
                            : active
                              ? "bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent-30)]"
                              : "bg-[var(--color-text-muted)]"
                    }`}
                />
            ))}
        </div>
    );
};
