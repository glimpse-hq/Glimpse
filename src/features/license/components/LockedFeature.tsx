import { useLingui } from "@lingui/react/macro";
import PlanPicker from "./PlanPicker";

export type LockedFeatureId = "personalization" | "library" | "record" | "api";

type LockedFeatureProps = {
  feature: LockedFeatureId;
  onEnterKey: () => void;
  compact?: boolean;
};

// Stands in for a feature the license doesn't cover, in the place the
// feature would be, so buying it doesn't mean leaving it.
const LockedFeature = ({
  feature,
  onEnterKey,
  compact = false,
}: LockedFeatureProps) => {
  const { t } = useLingui();

  const copy: Record<LockedFeatureId, { title: string; line: string }> = {
    personalization: {
      title: t({
        id: "locked.personalization.title.v4",
        message: "Personalization comes with a Glimpse license",
      }),
      line: t({
        id: "locked.personalization.line",
        message:
          "Give each app or website its own writing style. It uses your writing model.",
      }),
    },
    library: {
      title: t({
        id: "locked.library.title.v4",
        message: "Library comes with a Glimpse license",
      }),
      line: t({
        id: "locked.library.line",
        message:
          "Transcribe audio and video files, label speakers, and export transcripts.",
      }),
    },
    record: {
      title: t({
        id: "locked.record.title.v4",
        message: "Record comes with a Glimpse license",
      }),
      line: t({
        id: "locked.record.line",
        message:
          "Record meetings from your microphone and computer audio, with bookmarks and speaker labels.",
      }),
    },
    api: {
      title: t({
        id: "locked.api.title.v4",
        message: "The API server comes with a Glimpse license",
      }),
      line: t({
        id: "locked.api.line.v2",
        message:
          "Run a local transcription API and the command line tool. They aren't part of the trial.",
      }),
    },
  };

  return (
    <div
      className={`mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center ${compact ? "" : "py-10"}`}
    >
      <h2 className="font-satoshi ui-text-screen-title ui-color-primary tracking-tight text-balance">
        {copy[feature].title}
      </h2>
      <p className="mt-2 ui-text-body-sm ui-color-muted text-pretty">
        {copy[feature].line}
      </p>

      <div className="mt-7">
        <PlanPicker source="locked_view" feature={feature} />
      </div>

      <button
        type="button"
        onClick={onEnterKey}
        className="mx-auto mt-1 ui-text-meta ui-color-secondary transition-colors hover:text-content-primary"
      >
        {t({
          id: "locked.enter_key",
          message: "Already bought? Enter your license key",
        })}
      </button>
    </div>
  );
};

export default LockedFeature;
