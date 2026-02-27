// ============================================================
//  models/Message.js
//  Un message appartient toujours à une Coloc.
//  Le chat est donc isolé par coloc.
// ============================================================

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    colocId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Coloc',
      required: [true, 'Un message doit appartenir à une coloc']
    },
    username: {
      type:     String,
      required: true,
      trim:     true
    },
    avatar: {
      type:    String,
      default: '🧑'
    },
    text: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 300
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);
