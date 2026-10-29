using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace FormPlatform.Api.Migrations
{
    /// <inheritdoc />
    public partial class IcfApprovalWorkflow : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApprovalHash",
                table: "Icfs",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ApprovedAt",
                table: "Icfs",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ApprovedBy",
                table: "Icfs",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DesignersJson",
                table: "Icfs",
                type: "jsonb",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "State",
                table: "Icfs",
                type: "text",
                nullable: false,
                defaultValue: "published");
            migrationBuilder.Sql("UPDATE \"Icfs\" SET \"State\" = 'retired' WHERE NOT \"Active\";");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ApprovalHash",
                table: "Icfs");

            migrationBuilder.DropColumn(
                name: "ApprovedAt",
                table: "Icfs");

            migrationBuilder.DropColumn(
                name: "ApprovedBy",
                table: "Icfs");

            migrationBuilder.DropColumn(
                name: "DesignersJson",
                table: "Icfs");

            migrationBuilder.DropColumn(
                name: "State",
                table: "Icfs");
        }
    }
}
