import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { colorForKey, OTHER_COLOR, SERIES_COLORS } from "@/components/charts/palette";

/**
 * The charts, rendered.
 *
 * These are the cases that produce a chart which looks fine and says nothing:
 * a path full of `NaN` draws no line at all, and a browser reports no error
 * when it happens. Everything here is arithmetic on the edges — one point, no
 * points, all zeroes — which is exactly where the divisions in the scaling
 * code fall over.
 */

const draw = (element: React.ReactElement) => renderToStaticMarkup(element);

describe("The line chart", () => {
  const series = (values: number[]) => [
    { key: "revenue", label: "Revenue", color: "#2a78d6", values },
  ];

  it("When there are several points, then it draws a path with real coordinates", () => {
    const html = draw(
      <LineChart labels={["Mon", "Tue", "Wed"]} series={series([10, 40, 25])} />,
    );

    expect(html).toContain("<path");
    expect(html).not.toContain("NaN");
  });

  it("When every value is zero, then it still draws rather than dividing by it", () => {
    // A quiet week is the most likely real input and the one that breaks a
    // naive `value / max`.
    const html = draw(
      <LineChart labels={["Mon", "Tue", "Wed"]} series={series([0, 0, 0])} />,
    );

    expect(html).not.toContain("NaN");
    expect(html).toContain("<path");
  });

  it("When there is a single point, then it is marked instead of left invisible", () => {
    // One point has no line to look at, and `index / (count - 1)` is a
    // division by zero.
    const html = draw(<LineChart labels={["Mon"]} series={series([42])} />);

    expect(html).not.toContain("NaN");
    expect(html).toContain("<circle");
  });

  it("When the range came back empty, then it says so rather than drawing nothing", () => {
    const html = draw(<LineChart labels={[]} series={series([])} />);

    expect(html).toContain("Nothing to plot");
  });

  it("When the axis is drawn, then the grid uses the recessive token", () => {
    const html = draw(
      <LineChart labels={["Mon", "Tue"]} series={series([1, 2])} />,
    );

    expect(html).toContain("var(--color-chart-grid)");
  });
});

describe("The bar chart", () => {
  const bars = [
    { key: "plus", label: "Plus", value: 600, color: "#2a78d6" },
    { key: "basic", label: "Basic", value: 200, color: "#eb6834" },
  ];

  it("When bars are drawn, then each carries its own value as a label", () => {
    // Direct labels are what let the chart be read without measuring anything
    // against an axis.
    const html = draw(<BarChart data={bars} formatValue={(v) => `$${v}`} />);

    expect(html).toContain("$600");
    expect(html).toContain("$200");
    expect(html).toContain("Plus");
  });

  it("When a shared ceiling is given, then bars are drawn against it", () => {
    // The funnel needs every stage measured against the top of the funnel,
    // not each filling its own row.
    const html = draw(<BarChart data={bars} max={1200} />);

    expect(html).toContain("width:50%");
  });

  it("When everything is zero, then it renders without dividing by zero", () => {
    const html = draw(
      <BarChart data={[{ key: "a", label: "A", value: 0, color: "#000" }]} />,
    );

    expect(html).not.toContain("NaN");
  });

  it("When there is nothing to show, then it says so", () => {
    const html = draw(<BarChart data={[]} emptyMessage="Nothing sold." />);

    expect(html).toContain("Nothing sold.");
  });
});

describe("The palette", () => {
  it("When an entity is coloured, then the colour follows the entity, not its rank", () => {
    // The regression this guards: a filter that drops one plan must not
    // repaint the ones that survive.
    const order = ["Basic", "Complete", "Plus"];

    expect(colorForKey("Plus", order)).toBe(SERIES_COLORS[2]);
    expect(colorForKey("Plus", order)).toBe(colorForKey("Plus", order));
  });

  it("When there are more entities than hues, then the extras are grouped", () => {
    // Never a generated hue: past the fixed order everything folds into one
    // neutral, which is honest about the chart having run out of colours.
    const order = ["a", "b", "c", "d", "e", "f", "g"];

    expect(colorForKey("f", order)).toBe(OTHER_COLOR);
    expect(colorForKey("g", order)).toBe(OTHER_COLOR);
  });

  it("When the entity is unknown, then it does not fall back to the first hue", () => {
    expect(colorForKey("missing", ["a", "b"])).toBe(OTHER_COLOR);
  });
});
