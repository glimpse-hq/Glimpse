import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const areSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

// Today, Yesterday, a weekday within the week, then the date.
export const formatDayLabel = (date: Date, i18n: I18n) => {
  const now = new Date();
  const target = startOfDay(date);
  const diffDays = Math.round(
    (startOfDay(now).getTime() - target.getTime()) / 86400000,
  );
  if (diffDays === 0)
    return i18n._(msg({ id: "transcriptions.group.today", message: "Today" }));
  if (diffDays === 1)
    return i18n._(
      msg({ id: "transcriptions.group.yesterday", message: "Yesterday" }),
    );
  if (diffDays > 1 && diffDays < 7) {
    return target.toLocaleDateString(i18n.locale, { weekday: "long" });
  }
  if (target.getFullYear() === now.getFullYear()) {
    return target.toLocaleDateString(i18n.locale, {
      month: "long",
      day: "numeric",
    });
  }
  return target.toLocaleDateString(i18n.locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};
