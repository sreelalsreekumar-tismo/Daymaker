using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Daymaker.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSummaryTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LastSummaryUtc",
                table: "Preferences",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastSummaryUtc",
                table: "Preferences");
        }
    }
}
