import { useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { ArrowUpRight, CircleNotch as Loader2 } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  EDITION_COLORS,
  editionFromLicenseState,
} from "../../../shared/lib/licenseEdition";
import { TypewriterText } from "../../../shared/ui/TypewriterText";
import type { LicenseState } from "../api";
import { useDictationStats } from "../queries";
import {
  CARD_TITLE_FONT,
  CARD_DETAILS_HEIGHT,
  CardDetailsGrid,
  CardDottedRule,
  CardHeadlineBlock,
  CardHeaderRow,
  CARD_DETAILS_HEIGHT_SLIM,
  CARD_HEADLINE_HEIGHT_EXPANDED,
  formatCardDate,
  getCardShellStyle,
  getMemberCardHeight,
  MemberCardFrame,
  MemberCardPaletteProvider,
  MemberCardPaperOverlays,
  MemberCardStripe,
  STAMP_LAYER_CLASS,
  TierStamp,
  useMemberCardPalette,
} from "./memberCardShared";
import {
  REVEAL_NAME_SPEED_MS,
  useCardActivationSequence,
} from "./useCardActivationSequence";

export const PLACEHOLDER = "-";

type MemberCardProps = {
  active: boolean;
  activating?: boolean;
  activationAttempt?: number;
  licenseLoading?: boolean;
  licenseState: LicenseState | null;
  opening?: boolean;
  checkoutDisabled?: boolean;
  onOpenCheckout?: () => void;
  onRevealComplete?: () => void;
};

const revealEase = [0.22, 1, 0.36, 1] as const;
const stampSlamEase = [0.34, 1.45, 0.64, 1] as const;

const MemberCard = (props: MemberCardProps) => (
  <MemberCardPaletteProvider>
    <MemberCardInner {...props} />
  </MemberCardPaletteProvider>
);

const MemberCardInner = ({
  active,
  activating = false,
  activationAttempt = 0,
  licenseLoading = false,
  licenseState,
  opening = false,
  checkoutDisabled = false,
  onOpenCheckout,
  onRevealComplete,
}: MemberCardProps) => {
  const { t } = useLingui();
  const palette = useMemberCardPalette();
  const [coverageExtraHeight, setCoverageExtraHeight] = useState(0);
  const coverageTextRef = useRef<HTMLDivElement>(null);
  const stripeSeedRef = useRef(
    licenseState?.displayKey && active
      ? licenseState.displayKey
      : "draft-glimpse",
  );

  const displayKey = licenseState?.displayKey ?? null;
  const email = licenseState?.customerEmail ?? null;
  const customerName = licenseState?.customerName ?? null;
  const memberSinceISO =
    licenseState?.purchasedAt ?? licenseState?.activatedAt ?? null;
  const activeDevices = licenseState?.activationsCount ?? null;
  const deviceLimit = licenseState?.activationsLimit ?? 5;

  const edition = editionFromLicenseState(licenseState, active);
  const editionLabel =
    edition === "commercial"
      ? t({ id: "member_card.tier_commercial", message: "Commercial" })
      : edition === "founder"
        ? t({ id: "member_card.tier_founder", message: "Founder" })
        : edition === "contributor"
          ? t({ id: "member_card.tier_contributor", message: "Contributor" })
          : t({ id: "member_card.tier_personal", message: "Personal" });
  const editionBlurb =
    edition === "commercial"
      ? t({
          id: "member_card.edition_blurb_commercial",
          message: "For work. One person per seat, billed yearly.",
        })
      : edition === "founder"
        ? t({
            id: "member_card.edition_blurb_founder_short",
            message: "Launch founder.",
          })
        : edition === "contributor"
          ? t({
              id: "member_card.edition_blurb_contributor_short",
              message: "Thank you for contributing.",
            })
          : t({
              id: "member_card.edition_blurb_personal_short",
              message: "For you.",
            });
  const editionColors = EDITION_COLORS[edition];
  const name = customerName?.trim() || null;
  const displayTitle = name || email;
  const memberSinceValue = formatCardDate(memberSinceISO) ?? PLACEHOLDER;
  const dictationStatsQuery = useDictationStats();
  const wordsSpoken = dictationStatsQuery.data?.totalWords ?? null;
  const wordsSpokenValue =
    wordsSpoken !== null ? wordsSpoken.toLocaleString() : PLACEHOLDER;
  const licenseReady = Boolean(active && displayKey && (name || email));

  const cardHeight = getMemberCardHeight(coverageExtraHeight);
  const expandedHeadline = !active;
  const checkoutBlocked = checkoutDisabled || opening;

  const {
    stage,
    cinematic,
    typingReveal,
    showTierPicker,
    showStamp,
    showName,
    showEmail,
    showDetails,
    showCoverage,
    isUserActivationReveal,
    stampSlam,
  } = useCardActivationSequence(
    activating,
    active,
    displayTitle,
    licenseReady,
    licenseLoading,
    activationAttempt,
  );

  const revealCompletedRef = useRef(false);
  useEffect(() => {
    if (!active) {
      revealCompletedRef.current = false;
      return;
    }
    if (
      stage === "done" &&
      isUserActivationReveal &&
      !revealCompletedRef.current
    ) {
      revealCompletedRef.current = true;
      onRevealComplete?.();
    }
  }, [active, stage, isUserActivationReveal, onRevealComplete]);

  const licenseResolved = !licenseLoading || licenseState !== null;
  const showDraftChrome =
    licenseResolved && !active && !cinematic && !activating;

  useEffect(() => {
    if (stage === "draft") {
      stripeSeedRef.current = "draft-glimpse";
    } else if (displayKey) {
      stripeSeedRef.current = displayKey;
    }
  }, [stage, displayKey]);

  const visualSeed = stripeSeedRef.current;
  const stripeDotTransition =
    isUserActivationReveal && cinematic && displayKey
      ? ("sweep" as const)
      : ("none" as const);
  const buyDisabled = checkoutBlocked || cinematic || !showDraftChrome;

  const idlePrompt = t({
    id: "member_card.draft_idle",
    message: "Buy a license",
  });

  const coverageBase = editionBlurb;
  const coverageLine =
    activeDevices !== null
      ? t({
          id: "member_card.coverage_with_devices",
          message: `${coverageBase} · ${activeDevices} of ${deviceLimit} devices active`,
        })
      : coverageBase;

  useLayoutEffect(() => {
    const element = coverageTextRef.current;
    if (!element) {
      setCoverageExtraHeight(0);
      return;
    }

    const updateHeight = () => {
      const lineHeight = Number.parseFloat(
        window.getComputedStyle(element).lineHeight,
      );
      const singleLineHeight = Number.isFinite(lineHeight) ? lineHeight : 14;
      setCoverageExtraHeight(
        Math.max(0, Math.ceil(element.scrollHeight - singleLineHeight)),
      );
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [coverageLine, showCoverage, typingReveal]);

  const titleStyle = {
    fontFamily: CARD_TITLE_FONT,
    fontSize: "26px",
    lineHeight: 1.35,
    margin: 0,
    color:
      showName && displayTitle ? palette.textPrimary : palette.textDisabled,
  } as const;

  const subtitleStyle = {
    fontSize: "13px",
    fontWeight: 500,
    lineHeight: 1.35,
    margin: 0,
    color: palette.textDisabled,
  } as const;

  return (
    <article
      className="relative flex flex-col overflow-visible text-left"
      style={getCardShellStyle(palette, coverageExtraHeight)}
      aria-label={
        active
          ? t({
              id: "member_card.aria",
              message: "Glimpse member card",
            })
          : t({
              id: "member_card.draft_aria",
              message: "Draft Glimpse member card",
            })
      }
    >
      <MemberCardPaperOverlays seedKey={visualSeed} cardHeight={cardHeight} />
      <MemberCardFrame>
        <CardHeaderRow
          stamp={
            showStamp && displayKey ? (
              <SlamTierStamp
                key={displayKey}
                label={editionLabel}
                color={editionColors.fg}
                bg={editionColors.bg}
                playSlam={isUserActivationReveal && stampSlam}
              />
            ) : (
              <span
                className="absolute inset-x-0 flex justify-end font-mono uppercase tracking-[0.16em]"
                style={{
                  top: "-11px",
                  fontSize: "10px",
                  fontWeight: 700,
                  lineHeight: 1.35,
                  color: palette.textDisabled,
                  textShadow: palette.wordmarkShadow,
                  opacity: cinematic ? 0.25 : 0.55,
                }}
              >
                {cinematic
                  ? t({
                      id: "member_card.draft_stamp_issuing",
                      message: "Issuing",
                    })
                  : t({
                      id: "member_card.draft_stamp_empty",
                      message: "Unissued",
                    })}
              </span>
            )
          }
        />

        <CardHeadlineBlock
          height={expandedHeadline ? CARD_HEADLINE_HEIGHT_EXPANDED : undefined}
          title={
            showName && displayTitle ? (
              typingReveal ? (
                <TypewriterText
                  key={`reveal-name-${displayKey}`}
                  text={displayTitle}
                  as="h2"
                  className="font-bold tracking-[-0.02em] break-words"
                  style={{
                    ...titleStyle,
                    ...(displayTitle === email
                      ? { fontSize: "20px", lineHeight: 1.15 }
                      : {}),
                  }}
                  speedMs={REVEAL_NAME_SPEED_MS}
                />
              ) : (
                <h2
                  className="font-bold tracking-[-0.02em] break-words"
                  style={{
                    ...titleStyle,
                    ...(displayTitle === email
                      ? { fontSize: "20px", lineHeight: 1.15 }
                      : {}),
                  }}
                >
                  {displayTitle}
                </h2>
              )
            ) : cinematic ? (
              <motion.h2
                className="font-bold tracking-[-0.02em] break-words"
                style={{
                  ...titleStyle,
                  color: palette.textDisabled,
                  opacity: 0.35,
                }}
                initial={{ opacity: 0.55 }}
                animate={{ opacity: 0.35 }}
                transition={{ duration: 0.45 }}
              >
                {PLACEHOLDER}
              </motion.h2>
            ) : active ? (
              <h2
                className="font-bold tracking-[-0.02em] break-words"
                style={{ ...titleStyle, color: palette.textDisabled }}
              >
                {PLACEHOLDER}
              </h2>
            ) : (
              <h2
                className="font-bold tracking-[-0.02em] break-words"
                style={titleStyle}
              >
                {idlePrompt}
              </h2>
            )
          }
          subtitle={
            showEmail && name && email ? (
              typingReveal ? (
                <TypewriterText
                  key={`reveal-email-${displayKey}`}
                  text={email}
                  as="p"
                  className="break-words"
                  style={subtitleStyle}
                  speedMs={22}
                />
              ) : (
                <p className="break-words" style={subtitleStyle}>
                  {email}
                </p>
              )
            ) : cinematic ? (
              <span aria-hidden="true">&nbsp;</span>
            ) : (
              <span aria-hidden="true">&nbsp;</span>
            )
          }
        />

        <CardDetailsGrid
          height={
            expandedHeadline
              ? CARD_DETAILS_HEIGHT_SLIM
              : CARD_DETAILS_HEIGHT + coverageExtraHeight
          }
        >
          {active ? (
            <>
              <StatDetail
                label={t({
                  id: "member_card.label_member_since",
                  message: "Member since",
                })}
                value={memberSinceValue}
                show={showDetails}
              />
              <StatDetail
                label={t({
                  id: "member_card.label_words_spoken",
                  message: "Words spoken",
                })}
                value={wordsSpokenValue}
                show={showDetails}
                delaySec={0.12}
              />
            </>
          ) : null}

          <div className="relative col-span-2 shrink-0 pt-1">
            <CardDottedRule />
            <div
              className="relative mt-1.5"
              style={{ minHeight: `${28 + coverageExtraHeight}px` }}
            >
              {showTierPicker && showDraftChrome ? (
                <div className="absolute inset-0 flex items-stretch gap-0">
                  <BuyOption
                    opening={opening}
                    disabled={buyDisabled}
                    onClick={() => onOpenCheckout?.()}
                  />
                </div>
              ) : showCoverage ? (
                isUserActivationReveal &&
                typingReveal &&
                stage === "coverage" ? (
                  <motion.div
                    key="coverage-reveal"
                    ref={coverageTextRef}
                    className="absolute inset-x-0 top-0 whitespace-normal break-words font-mono"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.55, ease: revealEase }}
                  >
                    <TypewriterText
                      text={coverageLine}
                      as="p"
                      style={{
                        fontSize: "10px",
                        fontWeight: 500,
                        color: palette.textDisabled,
                        letterSpacing: "0.02em",
                      }}
                      speedMs={20}
                    />
                  </motion.div>
                ) : (
                  <p
                    ref={coverageTextRef}
                    className="absolute inset-x-0 top-0 whitespace-normal break-words font-mono"
                    style={{
                      fontSize: "10px",
                      fontWeight: 500,
                      color: palette.textDisabled,
                      letterSpacing: "0.02em",
                    }}
                  >
                    {coverageLine}
                  </p>
                )
              ) : cinematic ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 block font-mono"
                  style={{
                    fontSize: "10px",
                    color: palette.textDisabled,
                    opacity: 0.3,
                  }}
                >
                  {PLACEHOLDER}
                </span>
              ) : null}
            </div>
          </div>
        </CardDetailsGrid>

        <MemberCardStripe
          seedKey={visualSeed}
          transitionMode={stripeDotTransition}
        />
      </MemberCardFrame>
    </article>
  );
};

const SlamTierStamp = ({
  label,
  color,
  bg,
  playSlam,
}: {
  label: string;
  color: string;
  bg: string;
  playSlam: boolean;
}) => {
  if (!playSlam) {
    return (
      <div className={STAMP_LAYER_CLASS}>
        <TierStamp label={label} color={color} bg={bg} />
      </div>
    );
  }

  return (
    <motion.div
      className={STAMP_LAYER_CLASS}
      initial={{
        opacity: 0,
        scale: 1.55,
        rotate: -18,
        y: -18,
        filter: "blur(1px)",
      }}
      animate={{
        opacity: [0, 0.86, 1],
        scale: [1.55, 0.96, 1],
        rotate: [-18, 1.5, 0],
        y: [-18, 2, 0],
        filter: ["blur(1px)", "blur(0px)", "blur(0px)"],
      }}
      transition={{
        duration: 0.42,
        times: [0, 0.62, 1],
        ease: stampSlamEase,
      }}
    >
      <TierStamp label={label} color={color} bg={bg} />
    </motion.div>
  );
};

const StatDetail = ({
  label,
  value,
  show,
  delaySec = 0,
}: {
  label: string;
  value: string;
  show: boolean;
  delaySec?: number;
}) => {
  const palette = useMemberCardPalette();

  return (
    <motion.div
      className="min-w-0"
      initial={false}
      animate={{ opacity: show ? 1 : 0, y: show ? 0 : 4 }}
      transition={{
        duration: 0.5,
        ease: revealEase,
        delay: show ? delaySec : 0,
      }}
    >
      <dt
        className="font-mono uppercase tracking-[0.16em]"
        style={{
          fontSize: "9.5px",
          fontWeight: 600,
          color: palette.textDisabled,
        }}
      >
        {label}
      </dt>
      <dd
        className="mt-1 break-words font-mono"
        style={{
          fontSize: "13px",
          fontWeight: 500,
          color: palette.textPrimary,
        }}
      >
        {value}
      </dd>
    </motion.div>
  );
};

const BuyOption = ({
  opening,
  disabled,
  onClick,
}: {
  opening: boolean;
  disabled: boolean;
  onClick: () => void;
}) => {
  const { t } = useLingui();
  const palette = useMemberCardPalette();
  const accent = EDITION_COLORS.personal;
  const color = opening ? accent.fg : palette.textPrimary;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled && !opening}
      className="group flex min-w-0 flex-1 items-center justify-between gap-1.5 border-0 bg-transparent py-1.5 text-left disabled:opacity-50"
      style={{ color }}
    >
      <span
        className="min-w-0 truncate font-mono uppercase tracking-[0.05em] underline"
        style={{
          fontSize: "10px",
          fontWeight: 600,
          textUnderlineOffset: "3px",
          textDecorationColor: `color-mix(in srgb, ${color} 30%, transparent)`,
        }}
      >
        {t({ id: "member_card.buy_glimpse", message: "Buy Glimpse" })}
      </span>
      {opening ? (
        <Loader2
          size={11}
          className="shrink-0 animate-spin"
          style={{ color: accent.fg }}
        />
      ) : (
        <ArrowUpRight
          size={11}
          className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100"
          style={{ color: accent.fg }}
          aria-hidden="true"
        />
      )}
    </button>
  );
};

export default MemberCard;
