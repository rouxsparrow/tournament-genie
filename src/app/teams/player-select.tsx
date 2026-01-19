"use client";

import { useMemo, useRef, useState } from "react";

type PlayerOption = {
  id: string;
  name: string;
  gender: "MALE" | "FEMALE";
};

type PlayerSelectProps = {
  id: string;
  name: string;
  label: string;
  players: PlayerOption[];
  defaultPlayerId?: string;
};

export function PlayerSelect({
  id,
  name,
  label,
  players,
  defaultPlayerId,
}: PlayerSelectProps) {
  const options = useMemo(
    () =>
      players.map((player) => ({
        id: player.id,
        value: `${player.name} (${player.gender})`,
      })),
    [players]
  );

  const defaultValue =
    options.find((option) => option.id === defaultPlayerId)?.value ?? "";

  const [displayValue, setDisplayValue] = useState(defaultValue);
  const [selectedId, setSelectedId] = useState(defaultPlayerId ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredOptions = useMemo(() => {
    const query = displayValue.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) =>
      option.value.toLowerCase().includes(query)
    );
  }, [displayValue, options]);

  const handleChange = (value: string) => {
    setDisplayValue(value);
    const match = options.find((option) => option.value === value);
    setSelectedId(match?.id ?? "");
  };

  const handleSelect = (option: { id: string; value: string }) => {
    setDisplayValue(option.value);
    setSelectedId(option.id);
    setIsOpen(false);
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!containerRef.current?.contains(event.relatedTarget as Node)) {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} onBlur={handleBlur} className="relative">
      <label className="text-sm font-medium text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={displayValue}
        onChange={(event) => {
          handleChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className="mt-2 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground shadow-sm focus:border-ring focus:outline-none"
        placeholder="Search by name"
        required
      />
      {isOpen ? (
        <div className="absolute z-10 mt-2 w-full rounded-md border border-border bg-card shadow-lg">
          <ul className="max-h-48 overflow-auto py-1 text-sm text-foreground">
            {filteredOptions.length === 0 ? (
              <li className="px-3 py-2 text-muted-foreground">No matches found.</li>
            ) : (
              filteredOptions.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="flex w-full items-center px-3 py-2 text-left hover:bg-muted"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelect(option)}
                  >
                    {option.value}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        Start typing to filter the player list.
      </p>
      <input type="hidden" name={name} value={selectedId} />
    </div>
  );
}

