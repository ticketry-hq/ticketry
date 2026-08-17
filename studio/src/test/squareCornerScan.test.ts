import { describe, expect, it } from "vitest";

import { findNonZeroRadii, findRoundedUtilities } from "./squareCornerScan";

const lines = (...source: string[]) => source.join("\n");

describe("square-corners scan — rounded utilities", () => {
  it("ignores the English word in comments, identifiers and prose strings", () => {
    const source = lines(
      "// values are rounded to the nearest minute",
      "/* the estimate is rounded up */",
      "const rounded = Math.round(value);",
      'const label = "Durations are rounded to the nearest minute";',
      "export const isRounded = () => rounded > 0;",
    );

    expect(findRoundedUtilities(source)).toEqual([]);
  });

  it("flags a rounded utility inside a className string", () => {
    const source = lines(
      "export const Chip = () => (",
      '  <span className="border px-2 py-1 rounded">chip</span>',
      ");",
    );

    expect(findRoundedUtilities(source)).toEqual([{ line: 2, text: "rounded" }]);
  });

  it("flags suffixed, arbitrary and variant utilities in class expressions", () => {
    const source = lines(
      "const Panel = ({ active }: { active: boolean }) => (",
      "  <div",
      "    className={`border ${active ? \"rounded-md\" : \"\"} hover:rounded-full`}",
      "  />",
      ");",
      'const handle = <i className={"rounded-[4px]"} />;',
    );

    expect(findRoundedUtilities(source).map((finding) => finding.text)).toEqual([
      "rounded-md",
      "hover:rounded-full",
      "rounded-[4px]",
    ]);
  });

  it("flags a suffixed utility in a class constant declared outside JSX", () => {
    const source = 'const buttonClass = "border px-2 rounded-md";';

    expect(findRoundedUtilities(source)).toEqual([
      { line: 1, text: "rounded-md" },
    ]);
  });

  it("flags rounded utilities in an @apply rule but not in CSS comments", () => {
    const source = lines(
      "/* corners were rounded before the overhaul */",
      ".chip {",
      "  @apply border px-2 rounded-lg;",
      "}",
    );

    expect(findRoundedUtilities(source)).toEqual([
      { line: 3, text: "rounded-lg" },
    ]);
  });
});

describe("square-corners scan — radius declarations", () => {
  it("accepts every flat radius value", () => {
    const source = lines(
      "  border-radius: 0;",
      "  border-radius: 0px;",
      "  border-radius: 0 0 0 0;",
      "  border-radius: 0 !important;",
      "  border-top-left-radius: 0rem;",
      "  border-radius: 0 / 0;",
      '  const style = { borderRadius: "0px" };',
    );

    expect(findNonZeroRadii(source)).toEqual([]);
  });

  it("flags any radius that is not flat", () => {
    const source = lines(
      "  border-radius: 4px;",
      "  border-radius: 0 0 2px 0;",
      '  const style = { borderRadius: "50%" };',
    );

    expect(findNonZeroRadii(source).map((finding) => finding.line)).toEqual([
      1, 2, 3,
    ]);
  });
});
