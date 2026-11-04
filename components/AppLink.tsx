import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * BUG-10: every app page is rendered per user on the server (force-dynamic), so Next.js's automatic prefetch made
 * ~19 full background renders on each Overview load and several on every Issues page, none of which the user asked
 * for. The retest saw those background requests fail. Links therefore don't prefetch by default; a click is still a
 * client-side navigation (fetched on click). Pass prefetch explicitly to opt back in for a cheap, likely next page.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
