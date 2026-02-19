import { useState, useEffect, useCallback } from "react"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import WhatsNewModal from "./WhatsNewModal"
import DotMatrix from "../DotMatrix"

interface UpdateCheckerProps {
    autoCheck?: boolean
}

const PENDING_RESTART_KEY = "glimpse_update_pending_restart"

const formatError = (err: unknown): string => {
    if (err instanceof Error) {
        return `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ""}`
    }
    if (typeof err === "string") {
        return err
    }
    try {
        return JSON.stringify(err)
    } catch {
        return String(err)
    }
}

export function UpdateChecker({ autoCheck = true }: UpdateCheckerProps) {
    const [update, setUpdate] = useState<Update | null>(null)
    const [checking, setChecking] = useState(false)
    const [downloading, setDownloading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [error, setError] = useState<string | null>(null)
    const [downloadError, setDownloadError] = useState<string | null>(null)
    const [installed, setInstalled] = useState(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem(PENDING_RESTART_KEY) === "true"
        }
        return false
    })
    const [whatsNewOpen, setWhatsNewOpen] = useState(false)

    const checkForUpdates = useCallback(async () => {
        setChecking(true)
        setError(null)
        setDownloadError(null)
        try {
            const result = await check()
            setUpdate(result)
        } catch (err) {
            console.error("Update check failed:", err)
            setError(formatError(err))
        } finally {
            setChecking(false)
        }
    }, [])

    useEffect(() => {
        if (autoCheck) {
            checkForUpdates()
        }
    }, [autoCheck, checkForUpdates])

    useEffect(() => {
        let unlistenCheck: UnlistenFn | undefined

        listen("updater:check", () => {
            checkForUpdates()
        }).then((fn) => {
            unlistenCheck = fn
        })

        return () => {
            unlistenCheck?.()
        }
    }, [checkForUpdates])

    const handleDownloadAndInstall = async () => {
        if (!update) return

        setDownloading(true)
        setProgress(0)
        setError(null)
        setDownloadError(null)

        try {
            let downloaded = 0
            let contentLength = 0

            await update.downloadAndInstall((event) => {
                switch (event.event) {
                    case "Started":
                        contentLength = event.data.contentLength ?? 0
                        break
                    case "Progress":
                        downloaded += event.data.chunkLength
                        if (contentLength > 0) {
                            setProgress(Math.round((downloaded / contentLength) * 100))
                        }
                        break
                    case "Finished":
                        setProgress(100)
                        break
                }
            })

            setInstalled(true)
            setUpdate(null)
            localStorage.setItem(PENDING_RESTART_KEY, "true")
        } catch (err) {
            console.error("Update failed:", err)
            setDownloadError(formatError(err))
        } finally {
            setDownloading(false)
        }
    }

    const handleRelaunch = async () => {
        localStorage.removeItem(PENDING_RESTART_KEY)
        await relaunch()
    }

    if (installed) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3 h-[52px]"
            >
                <CheckCircle size={16} className="ui-color-success-strong" />
                <div className="flex-1">
                    <p className="ui-text-body-sm-strong ui-color-success-strong">Update installed!</p>
                    <p className="ui-text-meta ui-color-success-subtle">Restart the app to apply changes.</p>
                </div>
                <motion.button
                    onClick={handleRelaunch}
                    className="rounded-lg bg-green-500 px-3 py-1.5 ui-text-button ui-color-on-solid hover:bg-green-400 transition-colors"
                    whileTap={{ scale: 0.97 }}
                >
                    Restart Now
                </motion.button>
            </motion.div>
        )
    }

    if (update) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3 h-[52px]"
            >
                <Download size={16} className="ui-color-warning-strong" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="ui-text-body-sm-strong ui-color-warning-strong">
                            v{update.version} available
                        </p>
                        {downloadError && (
                            <span className="ui-text-meta ui-color-error-subtle whitespace-pre-wrap break-words">
                                {downloadError}
                            </span>
                        )}
                    </div>
                </div>
                <AnimatePresence mode="wait">
                    {downloading ? (
                        <motion.div
                            key="downloading"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex items-center gap-2"
                        >
                            <DotMatrix
                                rows={2}
                                cols={10}
                                activeDots={Array.from(
                                    { length: Math.min(10, Math.max(0, Math.floor((progress / 100) * 10))) },
                                    (_, col) => [col, col + 10],
                                ).flat()}
                                dotSize={2}
                                gap={2}
                                color="var(--color-accent)"
                                className="opacity-80"
                            />
                            <span className="ui-text-meta ui-color-muted w-8 tabular-nums">
                                {progress}%
                            </span>
                        </motion.div>
                    ) : (
                        <motion.button
                            key="update-btn"
                            onClick={handleDownloadAndInstall}
                            className="rounded-lg bg-amber-400 px-3 py-1.5 ui-text-button ui-color-on-warning hover:bg-amber-300 transition-colors"
                            whileTap={{ scale: 0.97 }}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            Update
                        </motion.button>
                    )}
                </AnimatePresence>
            </motion.div>
        )
    }

    if (error) {
        return (
            <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 h-[52px]">
                <AlertCircle size={16} className="ui-color-error-strong" />
                <div className="flex-1 min-w-0">
                    <p className="ui-text-body-sm-strong ui-color-error-strong">Update check failed</p>
                    <p className="ui-text-meta ui-color-error-subtle whitespace-pre-wrap break-words">{error}</p>
                </div>
                <motion.button
                    onClick={checkForUpdates}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-2.5 py-1.5 ui-text-button ui-color-error-strong hover:bg-red-500/10 transition-colors"
                    whileTap={{ scale: 0.97 }}
                >
                    <RefreshCw size={12} />
                    Retry
                </motion.button>
            </div>
        )
    }

    return (
        <>
            <div className="flex items-center gap-3 rounded-lg border border-border-primary bg-surface-surface px-4 py-3 h-[52px]">
                {checking ? (
                    <>
                        <Loader2 size={16} className="text-content-muted animate-spin shrink-0" />
                        <p className="flex-1 ui-text-body-sm ui-color-muted">Checking for updates...</p>
                    </>
                ) : (
                    <>
                        <CheckCircle size={16} className="text-content-disabled shrink-0" />
                        <p className="flex-1 ui-text-body-sm ui-color-primary">You're up to date!</p>
                        <button
                            onClick={() => setWhatsNewOpen(true)}
                            className="ui-text-label ui-color-muted hover:text-content-secondary underline underline-offset-2 transition-colors"
                        >
                            What's new?
                        </button>
                        <motion.button
                            onClick={checkForUpdates}
                            className="p-1.5 rounded-md text-content-muted hover:text-content-secondary hover:bg-surface-elevated transition-colors"
                            whileTap={{ scale: 0.95 }}
                            title="Check for updates"
                        >
                            <RefreshCw size={14} />
                        </motion.button>
                    </>
                )}
            </div>
            <WhatsNewModal isOpen={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
        </>
    )
}
