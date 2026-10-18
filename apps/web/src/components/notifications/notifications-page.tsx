import { RiCheckDoubleLine, RiInbox2Line } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { CustomizeGroup } from "../customize/customize-group";
import { SkeletonTableRows } from "../ui/skeleton";
import { WorkColumn, WorkEmpty, WorkHeaderAction, WorkPage } from "../work/work-pages";
import { NotificationRow } from "./notification-row";
import { useNotifications } from "./use-notifications";

/**
 * Otto: Notifications, the full list behind the rail's dot: Unread first, then Earlier. Opening
 * one marks it read and goes to its task or chat; Mark all read sits in the top bar.
 */
export function NotificationsPage() {
  const { t } = useI18n();
  const notifications = useNotifications();
  const unread = notifications.notifications.filter((notification) => notification.readAt === null);

  const earlier = notifications.notifications.filter(
    (notification) => notification.readAt !== null,
  );

  return (
    <WorkPage
      actions={
        notifications.unread > 0 ? (
          <WorkHeaderAction
            label={t("Mark all read")}
            icon={RiCheckDoubleLine}
            onClick={notifications.markAllRead}
          />
        ) : null
      }
    >
      {!notifications.loaded ? (
        <WorkColumn title={t("Notifications")}>
          <SkeletonTableRows label={t("Loading notifications…")} />
        </WorkColumn>
      ) : notifications.notifications.length === 0 ? (
        <WorkEmpty
          icon={<RiInbox2Line />}
          title={t("Hear when something needs you")}
          description={t(
            "When someone gives you a task, mentions you or answers you, it shows up here.",
          )}
        />
      ) : (
        <WorkColumn title={t("Notifications")}>
          <CustomizeGroup
            title={t("Unread")}
            count={unread.length}
            empty={
              unread.length === 0
                ? { icon: <RiCheckDoubleLine />, description: t("You're all caught up") }
                : null
            }
          >
            {unread.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                notifications={notifications}
              />
            ))}
          </CustomizeGroup>
          {earlier.length > 0 ? (
            <CustomizeGroup title={t("Earlier")} count={earlier.length} empty={null}>
              {earlier.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  notifications={notifications}
                />
              ))}
            </CustomizeGroup>
          ) : null}
        </WorkColumn>
      )}
    </WorkPage>
  );
}
