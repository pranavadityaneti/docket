import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your account, workspace and preferences.
        </p>
      </div>

      <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon name="construction" size={22} />
        </div>
        <div>
          <div className="font-medium">Nothing here yet</div>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            This is the home for profile, workspace, team and notification
            preferences — we&rsquo;ll decide together what belongs here.
          </p>
        </div>
      </Card>
    </div>
  );
}
