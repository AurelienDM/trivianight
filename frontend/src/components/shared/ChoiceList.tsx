import { normalizeChoices } from '@shared/questionNormalize';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export default function ChoiceList({
  choices,
  selected,
  onSelect,
  disabled,
  size = 'md',
}: {
  choices: string[];
  selected?: string;
  onSelect?: (choice: string) => void;
  disabled?: boolean;
  size?: 'md' | 'lg';
}) {
  const interactive = typeof onSelect === 'function';
  const list = normalizeChoices(choices) ?? choices;

  return (
    <ul className={`mc-choice-list ${size === 'lg' ? 'mc-choice-list--lg' : ''}`}>
      {list.map((choice, i) => {
        const letter = LETTERS[i] ?? String(i + 1);
        const isSelected = selected === choice;
        const className = [
          'mc-choice',
          isSelected ? 'mc-choice--selected' : '',
          interactive ? 'mc-choice--interactive' : '',
          disabled ? 'mc-choice--disabled' : '',
        ].filter(Boolean).join(' ');

        if (interactive) {
          return (
            <li key={choice}>
              <button
                type="button"
                className={className}
                disabled={disabled}
                onClick={() => onSelect?.(choice)}
              >
                <span className="mc-choice__badge" aria-hidden>{letter}</span>
                <span className="mc-choice__label">{choice}</span>
              </button>
            </li>
          );
        }

        return (
          <li key={choice} className={className}>
            <span className="mc-choice__badge" aria-hidden>{letter}</span>
            <span className="mc-choice__label">{choice}</span>
          </li>
        );
      })}
    </ul>
  );
}
