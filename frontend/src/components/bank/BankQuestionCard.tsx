import type { ReactNode } from 'react';
import {
  BANK_THEME_LABELS,
  type BankThemeId,
} from '@shared/bankThemes';
import ChoiceList from '../shared/ChoiceList';
import QuestionMedia from '../shared/QuestionMedia';
import type { MediaRef } from '@shared/types';

export interface BankCardItem {
  id: string;
  prompt: string;
  type: string;
  acceptedAnswers: string[];
  theme?: BankThemeId | string;
  source?: string;
  points?: number;
  useCount?: number;
  choices?: string[];
  notes?: string;
  mediaSearchTerms?: string[];
  orderItems?: string[];
  /** Optional stored media (when present) */
  media?: MediaRef;
}

function usageLabel(n: number | undefined, long = false): string {
  const count = typeof n === 'number' && n > 0 ? n : 0;
  if (count === 0) return long ? 'Never used in a quiz' : 'Never used';
  return long ? `Used in a quiz · ${count}×` : `Used before · ${count}×`;
}

function themeLabel(theme?: string): string {
  if (!theme) return '—';
  if (theme in BANK_THEME_LABELS) return BANK_THEME_LABELS[theme as BankThemeId];
  return theme;
}

function mediaCue(type: string): string | null {
  const t = type.toLowerCase();
  if (t === 'brand_logo' || t === 'image') return 'Image cue — attach media in the editor.';
  if (t === 'music') return 'Music cue — attach Deezer preview in the editor.';
  return null;
}

function needsMedia(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'brand_logo' || t === 'image' || t === 'music';
}

export default function BankQuestionCard({
  item,
  expanded,
  onToggle,
  onRemove,
  onFetchMedia,
  fetchBusy,
  selectable,
  selected,
  onSelectedChange,
  highlight,
  trailing,
}: {
  item: BankCardItem;
  expanded: boolean;
  onToggle: () => void;
  onRemove?: () => void;
  onFetchMedia?: () => void;
  fetchBusy?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (next: boolean) => void;
  highlight?: boolean;
  trailing?: ReactNode;
}) {
  const theme = themeLabel(item.theme);
  const cue = mediaCue(item.type);
  const hasChoices = Array.isArray(item.choices) && item.choices.length > 0;
  const hasOrder = Array.isArray(item.orderItems) && item.orderItems.length > 0;
  const answers = item.acceptedAnswers?.length ? item.acceptedAnswers : [];
  const hasMedia = !!(item.media?.url || item.media?.deezerTrackId || item.media?.previewUrl);
  const showMediaSection = hasMedia || needsMedia(item.type);

  return (
    <article
      className={`bank-card panel ${expanded ? 'bank-card--open' : ''} ${highlight ? 'ring-2 ring-[var(--accent)] anim-pop' : ''}`}
    >
      <div className="bank-card__row">
        {selectable && (
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={!!selected}
            onChange={(e) => {
              e.stopPropagation();
              onSelectedChange?.(e.target.checked);
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label="Select bank item"
          />
        )}
        <button
          type="button"
          className="bank-card__main"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <div className="bank-card__meta">
            <span>{item.type}</span>
            <span>{theme}</span>
            {item.source && <span>{item.source}</span>}
            <span className={item.useCount ? 'text-[var(--gold)]' : undefined}>
              {usageLabel(item.useCount)}
            </span>
          </div>
          <p className={`bank-card__prompt ${expanded ? 'bank-card__prompt--open' : ''}`}>
            {item.prompt}
          </p>
          {!expanded && (
            <p className="bank-card__peek">
              → {answers[0] || '—'}
            </p>
          )}
        </button>
        <div className="bank-card__actions" onClick={(e) => e.stopPropagation()}>
          {trailing}
          {onRemove && (
            <button
              type="button"
              className="btn btn-ghost text-sm text-[var(--danger)]"
              onClick={onRemove}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="bank-card__body">
          <dl className="bank-card__grid">
            <div>
              <dt>Type</dt>
              <dd className="capitalize">{item.type.replace(/_/g, ' ')}</dd>
            </div>
            <div>
              <dt>Theme</dt>
              <dd>{theme}</dd>
            </div>
            <div>
              <dt>Points</dt>
              <dd>{item.points && item.points > 0 ? item.points : 1}</dd>
            </div>
            <div>
              <dt>Usage</dt>
              <dd>{usageLabel(item.useCount, true)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{item.source || '—'}</dd>
            </div>
          </dl>

          <div className="bank-card__section">
            <p className="bank-card__label">Prompt</p>
            <p className="leading-snug">{item.prompt}</p>
          </div>

          {hasChoices && (
            <div className="bank-card__section">
              <p className="bank-card__label">Choices</p>
              <ChoiceList choices={item.choices!} size="md" />
            </div>
          )}

          {hasOrder && (
            <div className="bank-card__section">
              <p className="bank-card__label">Order</p>
              <ol className="list-decimal list-inside space-y-1 text-sm">
                {item.orderItems!.map((o, i) => (
                  <li key={`${o}-${i}`}>{o}</li>
                ))}
              </ol>
            </div>
          )}

          {showMediaSection && (
            <div className="bank-card__section">
              <p className="bank-card__label">Media</p>
              {hasMedia && item.media ? (
                <QuestionMedia
                  media={item.media}
                  revealMeta={false}
                  logoPanel={item.type === 'brand_logo'}
                />
              ) : (
                <div className="bank-card__media-cue">
                  <p className="text-[var(--danger)]">
                    No media attached yet{cue ? ` — ${cue}` : '.'}
                  </p>
                  {item.mediaSearchTerms?.length ? (
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Search terms: {item.mediaSearchTerms.join(' · ')}
                    </p>
                  ) : null}
                  {onFetchMedia && (
                    <button
                      type="button"
                      className="btn btn-ghost text-sm mt-3"
                      disabled={fetchBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        onFetchMedia();
                      }}
                    >
                      {fetchBusy ? 'Fetching…' : 'Fetch media'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="bank-card__section">
            <p className="bank-card__label">Accepted answers</p>
            <div className="flex flex-wrap gap-2">
              {answers.length ? answers.map((a) => (
                <span key={a} className="bank-card__answer-chip">{a}</span>
              )) : (
                <span className="text-sm text-[var(--muted)]">—</span>
              )}
            </div>
          </div>

          {item.notes && (
            <div className="bank-card__section">
              <p className="bank-card__label">Notes</p>
              <p className="text-sm text-[var(--muted)] whitespace-pre-wrap">{item.notes}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
