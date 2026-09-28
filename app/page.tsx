import Link from "next/link";
import { ArrowRightIcon, ChartNoAxesCombinedIcon, Layers3Icon, SparklesIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link className="flex items-center gap-3 font-semibold tracking-tight" href="/">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Layers3Icon aria-hidden="true" className="size-5" />
            </span>
            template-next-agent
          </Link>
          <Badge variant="outline">Open source starter</Badge>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-16 sm:py-24">
        <section className="flex max-w-3xl flex-col items-start gap-6">
          <Badge variant="secondary">
            <SparklesIcon aria-hidden="true" data-icon="inline-start" />
            Agent workflows, ready to explore
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Start with a working example. Make it yours.
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            A small Next.js starter for building practical AI workflows. Open a use case,
            inspect the code, and replace the sample data with your own.
          </p>
          <Link className={buttonVariants({ size: "lg" })} href="/transactions">
            Explore the first example
            <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
          </Link>
        </section>

        <section aria-labelledby="examples-heading" className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-muted-foreground">USE CASE DIRECTORY</p>
              <h2 className="text-2xl font-semibold tracking-tight" id="examples-heading">
                Explore the examples
              </h2>
            </div>
            <span className="text-sm text-muted-foreground">01 working example</span>
          </div>

          <Card className="max-w-3xl">
            <CardHeader>
              <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
                <ChartNoAxesCombinedIcon aria-hidden="true" className="size-5" />
              </div>
              <CardTitle className="text-xl">Financial transaction classification</CardTitle>
              <CardDescription className="max-w-xl leading-relaxed">
                Upload a CSV or try fictional transactions. Watch each row move through
                rules and Jev assisted classification, with results appearing as the
                workflow runs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">CSV import</Badge>
                <Badge variant="outline">Live row status</Badge>
                <Badge variant="outline">Workflow SDK + Jev</Badge>
              </div>
            </CardContent>
            <CardFooter>
              <Link className={buttonVariants({ variant: "secondary" })} href="/transactions">
                Open use case
                <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
              </Link>
            </CardFooter>
          </Card>
        </section>

        <Separator />

        <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>Built to be read, changed, and extended.</p>
          <p>Next.js · EVE · Vercel AI Gateway · Workflow SDK</p>
        </footer>
      </main>
    </div>
  );
}
