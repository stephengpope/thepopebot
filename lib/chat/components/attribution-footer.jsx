'use client';

import { useBranding } from 'thepopebot/branding/provider';

/**
 * Small "powered by" / attribution footer for the sidebar.
 * Renders nothing if ATTRIBUTION_TEXT is unset.
 *
 * @param {{ collapsed?: boolean }} props
 */
export function AttributionFooter({ collapsed }) {
  const { attributionText, attributionUrl } = useBranding();

  if (!attributionText || collapsed) return null;

  const content = (
    <span className="text-[10px] text-muted-foreground/70 leading-snug select-none">
      {attributionText}
    </span>
  );

  if (attributionUrl) {
    return (
      <div className="px-2 pb-1 pt-2">
        <a
          href={attributionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-muted-foreground transition-colors"
        >
          {content}
        </a>
      </div>
    );
  }

  return <div className="px-2 pb-1 pt-2">{content}</div>;
}
