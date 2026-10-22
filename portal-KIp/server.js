const app = require('./src/app');
const PORT = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Servidor NOC activo en http://localhost:${PORT}`);
        require('./src/services/emailIngestionService').activarAvisoInmediato();
    });
}

module.exports = app;