const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// Database Setup
const db = new sqlite3.Database('./kisan_sewa.db', (err) => {
    if (err) console.error("Database connection error:", err.message);
    else console.log("SQLite Database connected successfully.");
});

// Create Tables: Farmers, Categories, Items, Bookings, Messages
db.serialize(() => {
    // KISAAN PROFILE TABLE
    db.run(`CREATE TABLE IF NOT EXISTS farmers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        village TEXT,
        district TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_hindi TEXT NOT NULL,
        name_english TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER,
        name_hindi TEXT NOT NULL,
        name_english TEXT NOT NULL,
        size_variant TEXT,
        price REAL,
        subsidy TEXT,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )`);

    // BOOKINGS WITH FARMER REFERENCE
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        farmer_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        status TEXT DEFAULT 'Pending',
        booking_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (farmer_id) REFERENCES farmers(id),
        FOREIGN KEY (item_id) REFERENCES items(id)
    )`);

    // MESSAGES / INQUIRIES FROM FARMER
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        farmer_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (farmer_id) REFERENCES farmers(id)
    )`);
});

// ==========================================
// FARMER AUTH & PROFILE ROUTES
// ==========================================

// Farmer Registration / Login
app.post('/farmer/login', (req, res) => {
    const { name, phone, village, district } = req.body;
    
    // Check if farmer already exists
    db.get(`SELECT * FROM farmers WHERE phone = ?`, [phone], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        if (row) {
            // Already registered - Return profile
            return res.json({ message: "Welcome back!", farmer: row });
        } else {
            // New Registration
            db.run(`INSERT INTO farmers (name, phone, village, district) VALUES (?, ?, ?, ?)`,
                [name, phone, village || 'N/A', district || 'Uttarakhand'], function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    
                    db.get(`SELECT * FROM farmers WHERE id = ?`, [this.lastID], (err, newFarmer) => {
                        res.json({ message: "Registration successful!", farmer: newFarmer });
                    });
                });
        }
    });
});

// Farmer Sends a Message/Inquiry to Adhikari
app.post('/farmer/message', (req, res) => {
    const { farmer_id, message } = req.body;
    db.run(`INSERT INTO messages (farmer_id, message) VALUES (?, ?)`,
        [farmer_id, message], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Message sent to Adhikari successfully!" });
        });
});

// Farmer Submit Booking
app.post('/farmer/book', (req, res) => {
    const { farmer_id, item_id, quantity } = req.body;
    db.run(`INSERT INTO bookings (farmer_id, item_id, quantity) VALUES (?, ?, ?)`,
        [farmer_id, item_id, quantity], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Booking request submitted!", bookingId: this.lastID });
        });
});

// Get Catalog for Farmers
app.get('/farmer/catalog', (req, res) => {
    const query = `
        SELECT items.id AS item_id, items.name_hindi AS item_hindi, items.name_english AS item_english, 
               items.size_variant, items.price, items.subsidy,
               categories.name_hindi AS category_hindi, categories.name_english AS category_english
        FROM items
        JOIN categories ON items.category_id = categories.id
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ catalog: rows });
    });
});

// ==========================================
// ADHIKARI (ADMIN) PANEL ROUTES
// ==========================================

// 1. Get All Incoming Messages (with Farmer Details)
app.get('/admin/messages', (req, res) => {
    const query = `
        SELECT messages.id AS msg_id, messages.message, messages.sent_at,
               farmers.id AS farmer_id, farmers.name AS farmer_name, farmers.phone AS farmer_phone, 
               farmers.village, farmers.district
        FROM messages
        JOIN farmers ON messages.farmer_id = farmers.id
        ORDER BY messages.sent_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ messages: rows });
    });
});

// 2. Get Specific Farmer Profile & Full Booking/Message History
app.get('/admin/farmer-profile/:id', (req, res) => {
    const farmerId = req.params.id;

    db.get(`SELECT * FROM farmers WHERE id = ?`, [farmerId], (err, farmer) => {
        if (err || !farmer) return res.status(404).json({ error: "Farmer not found" });

        // Get Farmer's Bookings
        const bookingQuery = `
            SELECT bookings.id, items.name_hindi AS item_name, bookings.quantity, bookings.status, bookings.booking_date
            FROM bookings
            JOIN items ON bookings.item_id = items.id
            WHERE bookings.farmer_id = ?
        `;
        
        db.all(bookingQuery, [farmerId], (err, bookings) => {
            res.json({
                farmerProfile: farmer,
                bookingHistory: bookings
            });
        });
    });
});

// Add Category
app.post('/admin/category', (req, res) => {
    const { name_hindi, name_english } = req.body;
    db.run(`INSERT INTO categories (name_hindi, name_english) VALUES (?, ?)`, 
        [name_hindi, name_english], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Category added successfully", categoryId: this.lastID });
        });
});

// Add Item
app.post('/admin/item', (req, res) => {
    const { category_id, name_hindi, name_english, size_variant, price, subsidy } = req.body;
    db.run(`INSERT INTO items (category_id, name_hindi, name_english, size_variant, price, subsidy) VALUES (?, ?, ?, ?, ?, ?)`,
        [category_id, name_hindi, name_english, size_variant || 'N/A', price, subsidy || '0%'], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Item added successfully", itemId: this.lastID });
        });
});

// Delete Item
app.delete('/admin/item/:id', (req, res) => {
    db.run(`DELETE FROM items WHERE id = ?`, req.params.id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Item deleted successfully" });
    });
});
// Main URL par welcome message dikhane ke liye
app.get('/', (req, res) => {
  res.send('Uttarakhand Horticulture API is running successfully!');
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});