import { useLingui } from "@lingui/react/macro";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { GlimpseLogo } from "./GlimpseLogo";

interface FAQModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const FAQModal = ({ isOpen, onClose }: FAQModalProps) => {
    const { t } = useLingui();

    const faqItems = [
        {
            question: t({
                id: "faq.free.question",
                message: "How is Glimpse free?",
            }),
            answer: t({
                id: "faq.free.answer",
                message: "Glimpse uses on-device OSS AI models for transcription, so there are no ongoing costs for the core experience.",
            }),
        },
        {
            question: t({
                id: "faq.privacy.question",
                message: "Is my data private?",
            }),
            answer: t({
                id: "faq.privacy.answer",
                message: "Yes. All your audio and transcriptions stay on your device. We never collect or transmit your recordings.",
            }),
        },
        {
            question: t({
                id: "faq.data_use.question",
                message: "How is my data used?",
            }),
            answer: t({
                id: "faq.data_use.answer",
                message: "Your data is your data. Not ours to share. We will never sell or share your data with third parties.",
            }),
        },
        {
            question: t({
                id: "faq.delete.question",
                message: "What if I want to delete my data?",
            }),
            answer: t({
                id: "faq.delete.answer",
                message: "Delete recordings locally to remove them.",
            }),
        },
    ];

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs"
                    onClick={onClose}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="faq-title"
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-lg h-[75vh] bg-surface-tertiary rounded-2xl border border-border-secondary shadow-2xl shadow-black/50 overflow-hidden flex flex-col"
                    >
                        <div className="flex items-center justify-between px-7 pt-6 pb-2 shrink-0">
                            <div>
                                <h2 id="faq-title" className="ui-text-display font-normal ui-color-primary tracking-tight">
                                    {t({
                                        id: "faq.title",
                                        message: "Frequently Asked Questions",
                                    })}
                                </h2>
                                <p className="ui-text-meta ui-color-muted mt-1">
                                    {t({
                                        id: "faq.subtitle",
                                        message: "Common questions about Glimpse",
                                    })}
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-1.5 rounded-lg text-content-muted hover:text-content-primary hover:bg-surface-elevated transition-colors"
                                aria-label={t({
                                    id: "faq.close_aria",
                                    message: "Close FAQ",
                                })}
                            >
                                <X size={16} aria-hidden="true" />
                            </button>
                        </div>

                        <div className="relative flex-1 min-h-0 overflow-hidden">
                            <div
                                className="pointer-events-none absolute left-0 right-3 top-0 h-6 z-10"
                                style={{ background: "linear-gradient(to bottom, var(--color-bg-tertiary), transparent)" }}
                                aria-hidden="true"
                            />
                            <div
                                className="pointer-events-none absolute left-0 right-3 bottom-0 h-8 z-10"
                                style={{ background: "linear-gradient(to top, var(--color-bg-tertiary), transparent)" }}
                                aria-hidden="true"
                            />
                            <div className="h-full overflow-y-auto settings-scroll px-7 pt-5 pb-7">
                                <div className="space-y-8">
                                    {faqItems.map((item, index) => (
                                        <div key={index}>
                                            <h3 className="ui-text-body-lg-strong ui-color-primary mb-2">
                                                {item.question}
                                            </h3>
                                            <p className="ui-text-body leading-relaxed ui-color-secondary">
                                                {item.answer}
                                            </p>
                                            {index < faqItems.length - 1 && (
                                                <div className="border-t border-border-primary mt-6" />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-row items-center justify-between px-7 py-4 border-t border-border-primary bg-surface-primary shrink-0">
                            <div className="flex items-center gap-3">
                                <GlimpseLogo size="sm" />
                                <span className="ui-text-meta ui-color-disabled font-medium">
                                    {t({
                                        id: "faq.brand",
                                        message: "Glimpse",
                                    })}
                                </span>
                            </div>
                            <button
                                onClick={onClose}
                                className="px-4 py-2 rounded-lg bg-surface-elevated border border-border-secondary ui-text-body-sm-strong ui-color-secondary ui-hover-on-solid hover:border-border-hover transition-colors"
                            >
                                {t({
                                    id: "faq.confirm",
                                    message: "Got it",
                                })}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default FAQModal;
