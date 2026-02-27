// ============================================================
//  models/Item.js
//  Un article appartient toujours à une Coloc spécifique.
//  Le champ colocId est obligatoire et référence la collection Coloc.
//  Cela garantit qu'une liste ne peut jamais "fuir" vers une autre coloc.
// ============================================================

const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    // ── Appartenance à une coloc (OBLIGATOIRE) ───────────────
    colocId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Coloc',
      required: [true, 'Un article doit appartenir à une coloc']
    },

    // ── Données de l'article ─────────────────────────────────
    name: {
      type:     String,
      required: [true, 'Le nom de l\'article est obligatoire'],
      trim:     true
    },
    addedBy: {
      type:     String,
      required: [true, 'Le nom de l\'auteur est obligatoire'],
      trim:     true
    },
    category:       { type: String,  default: 'Autre', trim: true },
    quantity:       { type: Number,  default: 1, min: 0.1 },
    unit: {
      type:    String,
      default: 'pcs',
      enum:    ['pcs','kg','g','L','cL','mL','barquette','boîte','sachet','bouteille']
    },
    estimatedPrice: { type: Number,  default: 0, min: 0 },
    assignedTo:     { type: String,  default: '', trim: true },
    note:           { type: String,  default: '', trim: true },
    dueDate:        { type: Date,    default: null },
    bought:         { type: Boolean, default: false },
    urgent:         { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Item', itemSchema);
