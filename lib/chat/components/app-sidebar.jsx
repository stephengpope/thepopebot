'use client';

import { useState, useEffect } from 'react';
import { CirclePlusIcon, PanelLeftIcon, MessageIcon, ClusterIcon, BellIcon, RunnersIcon, ArrowUpCircleIcon, LifeBuoyIcon, GitPullRequestIcon } from './icons.js';
import { getUnreadNotificationCount, getPullRequestCount, getAppVersion } from '../actions.js';
import { SidebarHistory } from './sidebar-history.js';
import { SidebarUserNav } from './sidebar-user-nav.js';
import { UpgradeDialog } from './upgrade-dialog.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from './ui/sidebar.js';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip.js';
import { useChatNav } from './chat-nav-context.js';
import { useFeatures } from './features-context.js';

export function AppSidebar({ user }) {
  const features = useFeatures();
  const { navigateToChat } = useChatNav();
  const { state, open, setOpenMobile, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed';
  const [unreadCount, setUnreadCount] = useState(0);
  const [prCount, setPrCount] = useState(0);
  const [version, setVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(null);
  const [changelog, setChangelog] = useState(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Fetch badge counts (notifications + PRs) — run immediately, then every 10 minutes
  useEffect(() => {
    function fetchCounts() {
      getUnreadNotificationCount()
        .then((count) => setUnreadCount(count))
        .catch(() => {});
      getPullRequestCount()
        .then((count) => setPrCount(count))
        .catch(() => {});
    }
    fetchCounts();
    const interval = setInterval(fetchCounts, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Version check — one-time on mount
  useEffect(() => {
    getAppVersion()
      .then(({ version, updateAvailable, changelog }) => {
        setVersion(version);
        setUpdateAvailable(updateAvailable);
        setChangelog(changelog);
      })
      .catch(() => {});
  }, []);

  return (
    <>
    <Sidebar>
      <SidebarHeader>
        {/* Top row: brand name + toggle icon (open) or just toggle icon (collapsed) */}
        <div className={collapsed ? 'flex justify-center' : 'flex items-center justify-between'}>
          {!collapsed && (
            <span className="px-2 font-semibold text-lg">ThePopeBot{version && <span className="text-[11px] font-normal text-muted-foreground"> v{version}</span>}</span>
          )}
          <button
            className="inline-flex shrink-0 items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-background hover:text-foreground"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <PanelLeftIcon size={16} />
          </button>
        </div>

        <SidebarMenu>
          {/* New chat */}
          <SidebarMenuItem className="mb-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  href="/"
                  className={collapsed ? 'justify-center' : ''}
                  onClick={(e) => {
                    e.preventDefault();
                    navigateToChat(null);
                    setOpenMobile(false);
                  }}
                >
                  <CirclePlusIcon size={16} />
                  {!collapsed && <span>New chat</span>}
                </SidebarMenuButton>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">New chat</TooltipContent>
              )}
            </Tooltip>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {!collapsed && (
        <SidebarContent>
          <SidebarMenu>
            {/* Clusters */}
            {features?.clusterWorkspace && (
            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    href="/clusters"
                    className={collapsed ? 'justify-center' : ''}
                  >
                    <ClusterIcon size={16} />
                    {!collapsed && <span>Clusters</span>}
                  </SidebarMenuButton>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">Clusters</TooltipContent>
                )}
              </Tooltip>
            </SidebarMenuItem>
            )}

            {/* Chats history */}
            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    href="/chats"
                    className={collapsed ? 'justify-center' : ''}
                  >
                    <MessageIcon size={16} />
                    {!collapsed && <span>Chats</span>}
                  </SidebarMenuButton>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">Chats</TooltipContent>
                )}
              </Tooltip>
            </SidebarMenuItem>

            {/* Runners */}
            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    href="/runners"
                    className={collapsed ? 'justify-center' : ''}
                  >
                    <RunnersIcon size={16} />
                    {!collapsed && <span>Runners</span>}
                  </SidebarMenuButton>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">Runners</TooltipContent>
                )}
              </Tooltip>
            </SidebarMenuItem>

            {/* Pending Changes */}
            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    href="/pull-requests"
                    className={collapsed ? 'justify-center' : ''}
                  >
                    <GitPullRequestIcon size={16} />
                    {!collapsed && (
                      <span className="flex items-center gap-2">
                        Approvals
                        {prCount > 0 && (
                          <span className="inline-flex items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive-foreground">
                            {prCount}
                          </span>
                        )}
                      </span>
                    )}
                    {collapsed && prCount > 0 && (
                      <span className="absolute -top-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                        {prCount}
                      </span>
                    )}
                  </SidebarMenuButton>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">Approvals</TooltipContent>
                )}
              </Tooltip>
            </SidebarMenuItem>

            {/* Notifications */}
            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    href="/notifications"
                    className={collapsed ? 'justify-center' : ''}
                  >
                    <BellIcon size={16} />
                    {!collapsed && (
                      <span className="flex items-center gap-2">
                        Notifications
                        {unreadCount > 0 && (
                          <span className="inline-flex items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive-foreground">
                            {unreadCount}
                          </span>
                        )}
                      </span>
                    )}
                    {collapsed && unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium text-destructive-foreground">
                        {unreadCount}
                      </span>
                    )}
                  </SidebarMenuButton>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">Notifications</TooltipContent>
                )}
              </Tooltip>
            </SidebarMenuItem>

            {/* Upgrade (only when update is available) */}
            {updateAvailable && (
              <SidebarMenuItem>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuButton
                      className={collapsed ? 'justify-center' : ''}
                      onClick={() => setUpgradeOpen(true)}
                    >
                      <span className="relative">
                        <ArrowUpCircleIcon size={16} />
                        {collapsed && (
                          <span className="absolute -top-1 -right-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                        )}
                      </span>
                      {!collapsed && (
                        <span className="flex items-center gap-2">
                          Upgrade
                          <span className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
                            v{updateAvailable}
                          </span>
                        </span>
                      )}
                    </SidebarMenuButton>
                  </TooltipTrigger>
                  {collapsed && (
                    <TooltipContent side="right">Upgrade to v{updateAvailable}</TooltipContent>
                  )}
                </Tooltip>
              </SidebarMenuItem>
            )}

            {/* Support */}
            <SidebarMenuItem>
              <Tooltip>
                <TooltipTrigger asChild>
                  <SidebarMenuButton
                    href="https://www.skool.com/ai-architects"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={collapsed ? 'justify-center' : ''}
                  >
                    <LifeBuoyIcon size={16} />
                    {!collapsed && <span>Support</span>}
                  </SidebarMenuButton>
                </TooltipTrigger>
                {collapsed && (
                  <TooltipContent side="right">Support</TooltipContent>
                )}
              </Tooltip>
            </SidebarMenuItem>
          </SidebarMenu>

          <div className="mx-4 border-t border-border" />
          <SidebarHistory />
        </SidebarContent>
      )}

      {/* Spacer when collapsed to push footer down */}
      {collapsed && <div className="flex-1" />}

      <SidebarFooter>
        {user && <SidebarUserNav user={user} collapsed={collapsed} />}
      </SidebarFooter>
    </Sidebar>
    <UpgradeDialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} version={version} updateAvailable={updateAvailable} changelog={changelog} />
    </>
  );
}
