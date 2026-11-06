/**
 * The starting points the empty workspace offers (2026-11-06), as Google
 * Stitch's home offers suggested prompts. They are the six the Describe
 * dialog and then the empty chat offered until the owner removed them on
 * 2026-11-05 (`git show 0275cca~1:src/lib/promptToReport.ts`, where they were
 * PREDEFINED_PROMPTS), back by the owner's choice the next day, word for word.
 *
 * Each is a complete description on its own, written the way the DevExpress
 * documentation says a good prompt is written: layout, calculations,
 * grouping and the visual type, so the model assumes less. A click puts the
 * text in the box to be edited before it is sent; it is a start, not a
 * template. `gist` is the one line its card shows.
 */
export interface StartingPoint {
  id: string;
  title: string;
  gist: string;
  text: string;
}

export const STARTING_POINTS: readonly StartingPoint[] = Object.freeze([
  {
    id: 'invoice',
    title: 'Invoice',
    gist: 'Line items, tax and a total due',
    text:
      'An invoice. Company name, address and logo placeholder top left; the word INVOICE, the invoice number, ' +
      'invoice date and due date top right. A "Bill To" block with the customer name and address. A line-item table ' +
      'with columns Item, Description, Qty, Unit Price and Amount, with a bold heading row and right-aligned numbers. ' +
      'Below it, right-aligned: Subtotal, Tax, Shipping and a bold Total Due. Payment terms and a thank-you line at ' +
      'the bottom, and the page number in the footer.',
  },
  {
    id: 'customer-list',
    title: 'Customer list',
    gist: 'One ruled table, sorted by ID',
    text:
      'A customer listing. A title "Customer List" with the run date beside it. One table with columns Customer ID, ' +
      'Company, Contact, City, Country and Balance, with a ruled heading row that repeats on every page and ' +
      'right-aligned balances. Sorted by Customer ID. Page number in the footer.',
  },
  {
    id: 'sales-by-region',
    title: 'Sales by region',
    gist: 'Grouped, with subtotals and a chart',
    text:
      'A sales summary grouped by Region. For each region a group header with the region name, then rows of ' +
      'Salesperson, Orders, Revenue and Average Order, and a group footer with the region subtotal in bold. ' +
      'A grand total at the end of the report. A bar chart of revenue by region in the report header.',
  },
  {
    id: 'employee-directory',
    title: 'Employee directory',
    gist: 'Grouped by department, with photos',
    text:
      'An employee directory grouped by Department. Each row shows a photo placeholder, Name, Title, Email, Phone ' +
      'and Start Date. Department name in the group header with the head count, and the department on every page ' +
      'header. Page X of Y in the footer.',
  },
  {
    id: 'purchase-order',
    title: 'Purchase order',
    gist: 'Vendor, ship-to and line items',
    text:
      'A purchase order. Buyer name and address top left, "PURCHASE ORDER" with the PO number and date top right, ' +
      'a Vendor block and a Ship To block side by side, then a table with columns Line, Part Number, Description, ' +
      'Quantity, Unit Cost and Extended Cost. Subtotal, tax and total at the bottom right, an authorised-by ' +
      'signature line at the bottom left.',
  },
  {
    id: 'inventory',
    title: 'Inventory status',
    gist: 'By warehouse, low stock in red',
    text:
      'An inventory status report grouped by Warehouse. Columns SKU, Product, On Hand, Reserved, Available and ' +
      'Reorder Level, with rows whose Available is below Reorder Level shown in red. Warehouse totals in each group ' +
      'footer and a company total in the report footer. Report date in the header and page number in the footer.',
  },
]);

/** The projects the home lists first: the newest, archived ones left out, at most `limit`. */
export function recentProjects<T extends { id: string; timestamp: string }>(projects: readonly T[], archived: readonly string[], limit = 5): T[] {
  return projects
    .filter((p) => !archived.includes(p.id))
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit);
}
