import { MotionConfig } from "framer-motion";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSettings } from "../features/settings/queries";
import { useTextScale, useTheme } from "../shared/hooks/useAppearance";
import LiveView from "../features/recording/components/LiveView";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function LiveContent() {
  const { data: settings, isLoading } = useSettings();
  useTextScale();
  useTheme(settings?.theme_mode ?? null, isLoading);

  if (isLoading) return null;
  return (
    <MotionConfig reducedMotion="user">
      <LiveView />
    </MotionConfig>
  );
}

export default function LiveWindow() {
  return (
    <QueryClientProvider client={queryClient}>
      <LiveContent />
    </QueryClientProvider>
  );
}
