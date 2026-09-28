"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  GitForkIcon,
  LayoutGridIcon,
  ListFilterIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const navigation = [
  { href: "/", label: "Directory", icon: LayoutGridIcon },
  { href: "/transactions", label: "Transaction classification", icon: ListFilterIcon },
] as const;

function AppNavigation({ pathname }: { pathname: string }) {
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar className="border-sidebar-border" collapsible="offcanvas">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <Link
            className="flex min-w-0 items-center gap-2.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/"
            onClick={() => setOpenMobile(false)}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-foreground text-[13px] font-semibold text-background">
              T
            </span>
            <span className="truncate text-[13px] font-semibold tracking-tight">template-next-agent</span>
          </Link>
          <button
            aria-label="Close navigation"
            className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            onClick={() => setOpenMobile(false)}
            type="button"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent className="pt-5">
        <SidebarGroup className="px-3">
          <SidebarGroupLabel className="h-7 px-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Main navigation">
              <SidebarMenu className="gap-1">
                {navigation.map(({ href, icon: Icon, label }) => {
                  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        className="h-9 rounded-sm px-2.5 text-[13px] text-sidebar-foreground/75 data-active:bg-white data-active:text-sidebar-foreground data-active:shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-white/70 hover:text-sidebar-foreground"
                        isActive={active}
                        render={
                          <Link
                            aria-current={active ? "page" : undefined}
                            href={href}
                            onClick={() => setOpenMobile(false)}
                          />
                        }
                      >
                        <Icon aria-hidden="true" className="size-4" />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mt-8 border-t border-sidebar-border px-5 pt-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            Starter project
          </p>
          <p className="mt-3 max-w-44 text-xs leading-5 text-muted-foreground">
            A small, editable starting point for durable agent workflows.
          </p>
        </div>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-4">
        <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          Resources
        </p>
        <SidebarMenu className="gap-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-8 rounded-sm px-2.5 text-[13px] text-sidebar-foreground/75 hover:bg-white/70 hover:text-sidebar-foreground"
              render={
                <a
                  href="https://github.com/trancethehuman/template-next-agent#readme"
                  onClick={() => setOpenMobile(false)}
                  rel="noreferrer"
                  target="_blank"
                />
              }
            >
              <BookOpenIcon aria-hidden="true" className="size-4" />
              <span>Documentation</span>
              <ArrowUpRightIcon aria-hidden="true" className="ml-auto size-3.5 opacity-55" />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-8 rounded-sm px-2.5 text-[13px] text-sidebar-foreground/75 hover:bg-white/70 hover:text-sidebar-foreground"
              render={
                <a
                  href="https://github.com/trancethehuman/template-next-agent"
                  onClick={() => setOpenMobile(false)}
                  rel="noreferrer"
                  target="_blank"
                />
              }
            >
              <GitForkIcon aria-hidden="true" className="size-4" />
              <span>GitHub</span>
              <ArrowUpRightIcon aria-hidden="true" className="ml-auto size-3.5 opacity-55" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pageTitle = pathname.startsWith("/transactions")
    ? "Transaction classification"
    : "Use case directory";

  return (
    <TooltipProvider>
      <SidebarProvider>
        <a
          className="sr-only fixed left-3 top-3 z-50 rounded-sm bg-foreground px-3 py-2 text-sm text-background focus:not-sr-only"
          href="#main-content"
        >
          Skip to content
        </a>
        <AppNavigation pathname={pathname} />
        <SidebarInset className="min-w-0" id="main-content" tabIndex={-1}>
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 md:px-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <SidebarTrigger aria-label="Toggle navigation" className="-ml-1 rounded-sm" />
              <span className="hidden text-[13px] text-muted-foreground sm:inline">Workspace</span>
              <span aria-hidden="true" className="hidden text-border sm:inline">/</span>
              <span className="truncate text-[13px] font-medium text-foreground">{pageTitle}</span>
            </div>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              Open source starter
            </span>
          </header>
          <div className="mx-auto w-full max-w-7xl px-4 py-10 md:px-8 md:py-12">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
