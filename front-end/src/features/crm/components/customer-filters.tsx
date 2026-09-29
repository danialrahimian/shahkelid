import { Search, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LIFECYCLE_STAGE_ORDER,
  stageMetaFor,
} from "@/utils/lifecycle-stages";
import type { CustomersQuery, LifecycleStage } from "@/types/api";

/**
 * The filters, in one row above the list.
 *
 * The search box is debounced rather than fired on every keystroke: the server
 * has to join every account against its whole order history to answer, and
 * "daniel" typed at speed is six of those queries where one will do.
 *
 * Nothing is stored in two places. The parent owns the query and this only
 * reports changes, so a filter can never disagree with the list it produced.
 */

type SortOption = NonNullable<CustomersQuery["sort"]>;

const SORT_LABELS: Record<SortOption, string> = {
  value: "Highest lifetime value",
  orders: "Most orders",
  recent: "Bought most recently",
  joined: "Newest sign-up",
  name: "Name, A to Z",
};

/** The sentinel the select uses, since a Radix item cannot have an empty value. */
const ALL = "all";

export const CustomerFilters = ({
  query,
  onChange,
}: {
  query: CustomersQuery;
  onChange: (next: CustomersQuery) => void;
}) => {
  const [term, setTerm] = React.useState(query.search ?? "");

  // Kept in step when the parent clears the filters from elsewhere. Adjusted
  // during render, which React recommends over an effect: the effect showed
  // the old text for a frame and then replaced it.
  const [syncedSearch, setSyncedSearch] = React.useState(query.search);
  if (query.search !== syncedSearch) {
    setSyncedSearch(query.search);
    setTerm(query.search ?? "");
  }

  React.useEffect(() => {
    if (term === (query.search ?? "")) return;

    const timer = setTimeout(() => {
      // Any change to the filters returns to the first page. Staying on page
      // four of a list that now has one page shows an empty screen.
      onChange({ ...query, search: term || undefined, page: 1 });
    }, 300);

    return () => clearTimeout(timer);
    // `query` and `onChange` are deliberately left out: including them would
    // restart the timer on every render and the debounce would never fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const hasFilters = Boolean(query.search || query.stage || query.tag);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by name or email"
          aria-label="Search customers"
          className="pl-9"
        />
      </div>

      <Select
        value={query.stage ?? ALL}
        onValueChange={(value) =>
          onChange({
            ...query,
            stage: value === ALL ? undefined : (value as LifecycleStage),
            page: 1,
          })
        }
      >
        <SelectTrigger className="w-44" aria-label="Filter by stage">
          <SelectValue placeholder="Any stage" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Any stage</SelectItem>
          {LIFECYCLE_STAGE_ORDER.map((stage) => (
            <SelectItem key={stage} value={stage}>
              {stageMetaFor(stage).label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.sort ?? "value"}
        onValueChange={(value) =>
          onChange({ ...query, sort: value as SortOption, page: 1 })
        }
      >
        <SelectTrigger className="w-52" aria-label="Sort customers">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
            <SelectItem key={option} value={option}>
              {SORT_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => onChange({ sort: query.sort, page: 1 })}
        >
          <X className="size-3.5" />
          Clear
          {query.tag ? ` "${query.tag}"` : ""}
        </Button>
      ) : null}
    </div>
  );
};
