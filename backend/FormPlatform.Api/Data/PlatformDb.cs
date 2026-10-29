using Microsoft.EntityFrameworkCore;

namespace FormPlatform.Api.Data;

public sealed class PlatformDb(DbContextOptions<PlatformDb> options) : DbContext(options)
{
    public DbSet<PlatformUser> Users => Set<PlatformUser>();
    public DbSet<Study> Studies => Set<Study>();
    public DbSet<StudySite> Sites => Set<StudySite>();
    public DbSet<AccessGrant> Grants => Set<AccessGrant>();
    public DbSet<Subject> Subjects => Set<Subject>();
    public DbSet<VisitDefinition> VisitDefinitions => Set<VisitDefinition>();
    public DbSet<SubjectVisit> Visits => Set<SubjectVisit>();
    public DbSet<FormTemplate> Templates => Set<FormTemplate>();
    public DbSet<FormVersion> Versions => Set<FormVersion>();
    public DbSet<StudyFormAdoption> Adoptions => Set<StudyFormAdoption>();
    public DbSet<FormOccurrence> Occurrences => Set<FormOccurrence>();
    public DbSet<FormResponse> Responses => Set<FormResponse>();
    public DbSet<ResponseRevision> Revisions => Set<ResponseRevision>();
    public DbSet<CollectionBasis> Bases => Set<CollectionBasis>();
    public DbSet<IcfVersion> Icfs => Set<IcfVersion>();
    public DbSet<DataQuery> Queries => Set<DataQuery>();
    public DbSet<AuditEvent> Audit => Set<AuditEvent>();
    public DbSet<OutboxEvent> Outbox => Set<OutboxEvent>();
    public DbSet<ExportSnapshot> Exports => Set<ExportSnapshot>();
    public DbSet<ExternalIdentifierMapping> ExternalIds => Set<ExternalIdentifierMapping>();
    public DbSet<IntegrationReceipt> Receipts => Set<IntegrationReceipt>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        foreach (var type in typeof(Entity).Assembly.GetTypes().Where(t => t.IsSubclassOf(typeof(Entity))))
        {
            b.Entity(type).HasKey(nameof(Entity.Id));
            b.Entity(type).Property(nameof(Entity.Revision)).IsConcurrencyToken();
        }
        b.Entity<PlatformUser>().HasIndex(x => x.IdentitySubject).IsUnique();
        b.Entity<ExternalIdentifierMapping>().HasIndex(x => new { x.StudyId, x.SiteId, x.SourceSystem, x.EntityType, x.ExternalId }).IsUnique();
        b.Entity<IntegrationReceipt>().HasIndex(x => new { x.ActorId, x.RequestKey }).IsUnique();
        b.Entity<Study>().HasIndex(x => x.Code).IsUnique();
        b.Entity<StudySite>().HasIndex(x => new { x.StudyId, x.Code }).IsUnique();
        b.Entity<Subject>().HasIndex(x => new { x.StudyId, x.SiteId, x.Code }).IsUnique();
        b.Entity<VisitDefinition>().HasIndex(x => new { x.StudyId, x.Code }).IsUnique();
        b.Entity<FormVersion>().HasIndex(x => new { x.TemplateId, x.Version }).IsUnique();
        b.Entity<FormOccurrence>().HasIndex(x => new { x.SubjectVisitId, x.AdoptionId, x.Number }).IsUnique();
        b.Entity<FormResponse>().HasIndex(x => x.OccurrenceId).IsUnique();
        b.Entity<ResponseRevision>().HasIndex(x => new { x.ResponseId, x.ResponseRevisionNumber }).IsUnique();
        b.Entity<AccessGrant>().Property(x => x.Permissions).HasConversion<int>();
        b.Entity<Study>().Property(x => x.RequiredMappingsJson).HasColumnType("jsonb");
        b.Entity<FormVersion>().Property(x => x.ContractJson).HasColumnType("jsonb");
        b.Entity<FormVersion>().Property(x => x.DesignersJson).HasColumnType("jsonb");
        b.Entity<IcfVersion>().Property(x => x.DesignersJson).HasColumnType("jsonb");
        b.Entity<FormResponse>().Property(x => x.DataJson).HasColumnType("jsonb");
        b.Entity<ResponseRevision>().Property(x => x.DataJson).HasColumnType("jsonb");
        b.Entity<ResponseRevision>().Property(x => x.PreviousJson).HasColumnType("jsonb");
        b.Entity<OutboxEvent>().Property(x => x.PayloadJson).HasColumnType("jsonb");
        b.Entity<ExportSnapshot>().Property(x => x.PayloadJson).HasColumnType("jsonb");
        b.Entity<ExportSnapshot>().Property(x => x.SiteIdsJson).HasColumnType("jsonb");
        b.Entity<ExportSnapshot>().Property(x => x.SubjectIdsJson).HasColumnType("jsonb");
        b.Entity<IntegrationReceipt>().Property(x => x.ResultJson).HasColumnType("jsonb");
        Link<ExternalIdentifierMapping, Study>(b, nameof(ExternalIdentifierMapping.StudyId));
        Link<ExternalIdentifierMapping, StudySite>(b, nameof(ExternalIdentifierMapping.SiteId));
        Link<IntegrationReceipt, PlatformUser>(b, nameof(IntegrationReceipt.ActorId));
        Link<ExportSnapshot, Study>(b, nameof(ExportSnapshot.StudyId));
        Link<StudySite, Study>(b, nameof(StudySite.StudyId));
        Link<AccessGrant, Study>(b, nameof(AccessGrant.StudyId));
        Link<AccessGrant, PlatformUser>(b, nameof(AccessGrant.UserId));
        Link<AccessGrant, StudySite>(b, nameof(AccessGrant.SiteId));
        Link<Subject, Study>(b, nameof(Subject.StudyId));
        Link<Subject, StudySite>(b, nameof(Subject.SiteId));
        Link<VisitDefinition, Study>(b, nameof(VisitDefinition.StudyId));
        Link<SubjectVisit, Subject>(b, nameof(SubjectVisit.SubjectId));
        Link<SubjectVisit, VisitDefinition>(b, nameof(SubjectVisit.DefinitionId));
        Link<FormTemplate, Study>(b, nameof(FormTemplate.StudyId));
        Link<FormVersion, FormTemplate>(b, nameof(FormVersion.TemplateId));
        Link<StudyFormAdoption, Study>(b, nameof(StudyFormAdoption.StudyId));
        Link<StudyFormAdoption, FormVersion>(b, nameof(StudyFormAdoption.FormVersionId));
        Link<StudyFormAdoption, VisitDefinition>(b, nameof(StudyFormAdoption.VisitDefinitionId));
        Link<FormOccurrence, SubjectVisit>(b, nameof(FormOccurrence.SubjectVisitId));
        Link<FormOccurrence, StudyFormAdoption>(b, nameof(FormOccurrence.AdoptionId));
        Link<FormResponse, FormOccurrence>(b, nameof(FormResponse.OccurrenceId));
        Link<FormResponse, FormVersion>(b, nameof(FormResponse.FormVersionId));
        Link<ResponseRevision, FormResponse>(b, nameof(ResponseRevision.ResponseId));
        Link<CollectionBasis, Subject>(b, nameof(CollectionBasis.SubjectId));
        Link<CollectionBasis, IcfVersion>(b, nameof(CollectionBasis.IcfVersionId));
        Link<IcfVersion, Study>(b, nameof(IcfVersion.StudyId));
        Link<IcfVersion, StudySite>(b, nameof(IcfVersion.SiteId));
        Link<DataQuery, FormResponse>(b, nameof(DataQuery.ResponseId));
    }

    private static void Link<T, TPrincipal>(ModelBuilder b, string key)
        where T : class where TPrincipal : class =>
        b.Entity<T>().HasOne<TPrincipal>().WithMany().HasForeignKey(key).OnDelete(DeleteBehavior.Restrict);

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        foreach (var entry in ChangeTracker.Entries<Entity>())
        {
            if (entry.State is EntityState.Modified or EntityState.Deleted &&
                entry.Entity is AuditEvent or ResponseRevision or ExportSnapshot or IntegrationReceipt)
                throw new InvalidOperationException("稽核及修訂證據不可覆寫或刪除。");
            if (entry.State == EntityState.Modified)
                entry.Entity.Revision = entry.Property(x => x.Revision).OriginalValue + 1;
        }
        return base.SaveChangesAsync(ct);
    }
}
