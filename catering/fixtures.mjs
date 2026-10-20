// All names, contacts, prices and messages here are invented test fixtures.
function brief(id, guests, style, diets, budget, area = 'Fixture City') {
  return { id, guests, style, diets, budget, area, eventAt: '2026-11-05T12:00:00+01:00',
    deadline: '2026-11-03T12:00:00+01:00' };
}
export function vendor(b, id, body = null) {
  return {
    id, name: `Fictional ${id}`, scope: { area: b.area, style: b.style, source: `fixture:${id}/service-page` },
    contacts: [{ id: `${id}-request`, at: '2026-11-02T10:00:00+01:00', eventId: b.id,
      aiDisclosed: true, onBehalfOfCustomer: true, buyerDetailsShared: false }],
    replies: body === null ? [] : [{ id: `${id}-reply`, at: '2026-11-02T15:00:00+01:00', eventId: b.id, body }],
  };
}
export function reply(b, extra = '') {
  return `Event time: ${b.eventAt}\nAvailability: confirmed\nCapacity: ${b.guests}\n${extra}`;
}
const lunch = brief('office-40', 40, 'drop-off catering', ['vegan', 'gluten-free'],
  { currency: 'USD', minor: 3000, basis: 'person' });
const dining = brief('private-12', 12, 'private dining room', ['vegetarian'],
  { currency: 'USD', minor: 6000, basis: 'person' });
const large = brief('small-town-150', 150, 'buffet', ['vegan'],
  { currency: 'USD', minor: 500000, basis: 'total' }, 'Fixture Village');

export const scenarios = {
  lunch: { brief: lunch, vendors: [
    vendor(lunch, 'Cedar', reply(lunch, 'Menu: Lentil stew and rice\nPrice per person: USD 28.00\n' +
      'Minimum spend: USD 900.00\nDeposit: 25% after buyer acceptance\nCancellation: Seven days notice\n' +
      'Diet vegan: confirmed\nDiet gluten-free: We can discuss this\nPrice basis: final; taxes and mandatory fees included')),
    vendor(lunch, 'Maple', reply(lunch, 'Price per person: USD 22.00 plus tax\nDiet vegan: confirmed\nDiet gluten-free: cannot cover')),
    vendor(lunch, 'Elm'),
    vendor(lunch, 'Birch', `Event time: ${lunch.eventAt}\nAvailability: declined\nReason: Fully booked`),
  ] },
  dining: { brief: dining, vendors: [
    vendor(dining, 'Oak', reply(dining, 'Price per person: USD 72.00\nTotal: USD 864.00\n' +
      'Price basis: final; taxes and mandatory fees included\nDiet vegetarian: confirmed')),
    vendor(dining, 'Willow', reply(dining, 'Price per person: EUR 55.00\nDiet vegetarian: confirmed')),
    vendor(dining, 'Ash', reply(dining, 'Price per person: USD 55.00\nPrice basis: final; taxes and mandatory fees included')),
  ] },
  large: { brief: large, vendors: [
    vendor(large, 'Pine', 'Event time: 2026-11-05T12:00:00+01:00\nAvailability: confirmed\nCapacity: 100\n' +
      'Total: starting at USD 4000.00\nDiet vegan: confirmed'),
    vendor(large, 'Spruce'),
  ] },
};
