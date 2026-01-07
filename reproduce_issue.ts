import { groupSlotsIntoBookings } from './src/utils/cartHelpers';
import { parse } from 'date-fns';

// Mock simple usage
console.log("--- Testing groupSlotsIntoBookings with 3 SEPARATE HOURS ---");

const date = new Date('2025-12-25T00:00:00');
const slots = [
    'cabinet-1|10:00', 'cabinet-1|10:30', // Hour 1 (Cab 1)
    'cabinet-2|12:00', 'cabinet-2|12:30', // Hour 2 (Cab 2)
    'cabinet-3|14:00', 'cabinet-3|14:30'  // Hour 3 (Cab 3)
];

const bookings = groupSlotsIntoBookings(slots, date);
console.log(`Input: 6 slots (3 separate hours in different cabinets). Expect 3 bookings.`);
console.log(`Output: ${bookings.length} bookings.`);
bookings.forEach((b, i) => {
    console.log(`Booking ${i + 1}: ${b.resourceId} ${b.startTime} - ${b.endTime} (${b.duration}m)`);
});

if (bookings.length !== 3) {
    console.error("FAIL: Grouping logic for separate hours is wrong.");
} else {
    console.log("PASS: Grouping logic for separate hours is correct.");
}

console.log("\n--- Simulating UserStore.addBookings ---");
// Mock store
let storeBookings = [];
const currentUser = { email: 'me@test.com' };

const addBookings = (newBookingsData) => {
    let updatedBookings = [...storeBookings];
    newBookingsData.forEach(bd => {
        // Unique ID simulation
        updatedBookings.push({ ...bd, id: Math.random().toString(36).substr(2, 9) });
    });
    storeBookings = updatedBookings;
    console.log(`Store Bookings Count: ${storeBookings.length}`);
};

addBookings(bookings);

if (storeBookings.length !== 3) {
    console.error("FAIL: Store count mismatch.");
} else {
    // Verify they are distinct
    const ids = new Set(storeBookings.map(b => b.id));
    if (ids.size !== 3) {
        console.error("FAIL: Duplicate IDs generated.");
    } else {
        console.log("PASS: 3 distinct bookings added.");
        storeBookings.forEach(b => console.log(`Saved: ${b.resourceId} ${b.startTime}`));
    }
}
