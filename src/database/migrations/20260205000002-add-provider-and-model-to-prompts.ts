import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
    up: (queryInterface: QueryInterface) => {
        return Promise.all([
            queryInterface.addColumn("Prompts", "provider", {
                type: DataTypes.TEXT,
                defaultValue: "openai",
                allowNull: false
            }),
            queryInterface.addColumn("Prompts", "model", {
                type: DataTypes.TEXT,
                allowNull: true
            })
        ]);
    },

    down: (queryInterface: QueryInterface) => {
        return Promise.all([
            queryInterface.removeColumn("Prompts", "provider"),
            queryInterface.removeColumn("Prompts", "model")
        ]);
    }
};
