const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 1. Renderiza views/bitacora.ejs pasando req.user
exports.renderBitacora = (req, res) => {
  res.render('bitacora', { user: req.user });
};

// 2. Devuelve los últimos 100 mensajes del área requerida
exports.getMessages = async (req, res) => {
  try {
    const { area } = req.query; // o req.params dependiendo de la ruta
    if (!area) {
      return res.status(400).json({ error: 'Área es requerida' });
    }

    const messages = await prisma.bitacoraMessage.findMany({
      where: { area: area },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: {
          select: {
            nombre: true,
            rol: true
          }
        }
      }
    });

    // Invertir para que los más viejos estén al principio si es un chat
    res.json(messages.reverse());
  } catch (error) {
    console.error('Error fetching bitacora messages:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// 3. Crea el mensaje en DB y emite por sockets
exports.postMessage = async (req, res) => {
  try {
    const { area, contenido } = req.body;
    const userId = req.user?.id; // asumiendo que req.user lo pone el authMiddleware

    if (!area || !contenido || !userId) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const newMsg = await prisma.bitacoraMessage.create({
      data: {
        area,
        contenido,
        userId
      },
      include: {
        user: {
          select: {
            nombre: true,
            rol: true
          }
        }
      }
    });

    // Emitir socket
    const io = req.app.get('io');
    if (io) {
      io.to('area_' + area).emit('new_bitacora_message', newMsg);
    }

    res.status(201).json(newMsg);
  } catch (error) {
    console.error('Error posting bitacora message:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};
