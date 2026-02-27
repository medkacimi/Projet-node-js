// ============================================================
//  models/Coloc.js
//  Une "Coloc" est un espace partagé avec sa propre liste
//  de courses et son propre chat.
//
//  Chaque coloc a un code unique généré automatiquement
//  (ex: "BLEU-42") qui sert d'identifiant partageable.
//  Les colocataires rejoignent une coloc via ce code.
// ============================================================

const mongoose = require('mongoose');

const colocSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: [true, 'Le nom de la coloc est obligatoire'],
      trim:     true,
      maxlength: [30, 'Nom trop long (max 30 caractères)']
    },

    // Code unique généré automatiquement, ex : "SOLEIL-73"
    // Permet à d'autres membres de rejoindre la coloc
    code: {
      type:      String,
      required:  true,
      unique:    true,   // index unique dans MongoDB
      uppercase: true,
      trim:      true
    },

    // Emoji représentant la coloc (choisi à la création)
    emoji: {
      type:    String,
      default: '🏠'
    },

    // Liste des membres (stocke uniquement les noms, pas d'auth)
    members: [{ type: String, trim: true }],

    // Statut de la liste : 'active' ou 'validated'
    // Une liste validée est archivée et on repart d'une liste vide
    listStatus: {
      type:    String,
      enum:    ['active', 'validated'],
      default: 'active'
    },

    // Qui a validé la liste et quand
    validatedBy: { type: String, default: null },
    validatedAt: { type: Date,   default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Coloc', colocSchema);
