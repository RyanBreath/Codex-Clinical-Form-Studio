namespace FormPlatform.Api.Data;

[Flags]
public enum Permission
{
    None = 0, ManageStudy = 1, Design = 2, Publish = 4, Collect = 8,
    Review = 16, Lock = 32, ConfirmBasis = 64, ReadIcf = 128, Read = 256, Export = 512,
    Integrate = 1024, All = 2047
}

public abstract class Entity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public long Revision { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class PlatformUser : Entity
{
    public string IdentitySubject { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsOperator { get; set; }
    public bool Active { get; set; } = true;
    public string? IntegrationSource { get; set; }
}

public sealed class Study : Entity
{
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string ContextAuthority { get; set; } = "platform";
    public string IcfCustody { get; set; } = "site";
    public string RequiredMappingsJson { get; set; } = "[]";
    public bool Active { get; set; } = true;
}

public sealed class StudySite : Entity
{
    public Guid StudyId { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Active { get; set; } = true;
}

public sealed class AccessGrant : Entity
{
    public Guid UserId { get; set; }
    public Guid StudyId { get; set; }
    public Guid? SiteId { get; set; }
    public bool CrossSite { get; set; }
    public Permission Permissions { get; set; }
    public DateTimeOffset? ExpiresAt { get; set; }
}

public sealed class Subject : Entity
{
    public Guid StudyId { get; set; }
    public Guid SiteId { get; set; }
    public string Code { get; set; } = "";
}

public sealed class VisitDefinition : Entity
{
    public Guid StudyId { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
}

public sealed class SubjectVisit : Entity
{
    public Guid SubjectId { get; set; }
    public Guid? DefinitionId { get; set; }
    public string Name { get; set; } = "";
    public DateOnly Date { get; set; }
    public bool Unscheduled { get; set; }
}

public sealed class FormTemplate : Entity
{
    public Guid StudyId { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "ecrf";
}

public sealed class FormVersion : Entity
{
    public Guid TemplateId { get; set; }
    public string Version { get; set; } = "1.0.0";
    public string ContractJson { get; set; } = "{}";
    public string SourceYaml { get; set; } = "";
    public string ContentHash { get; set; } = "";
    public string State { get; set; } = "draft";
    public string DesignersJson { get; set; } = "[]";
    public Guid? ApprovedBy { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public string? ApprovalHash { get; set; }
}

public sealed class StudyFormAdoption : Entity
{
    public Guid StudyId { get; set; }
    public Guid FormVersionId { get; set; }
    public Guid? VisitDefinitionId { get; set; }
    public int MaximumOccurrences { get; set; } = 1;
    public bool Active { get; set; } = true;
}

public sealed class FormOccurrence : Entity
{
    public Guid SubjectVisitId { get; set; }
    public Guid AdoptionId { get; set; }
    public int Number { get; set; } = 1;
    public string? NotDoneReason { get; set; }
}

public sealed class FormResponse : Entity
{
    public Guid OccurrenceId { get; set; }
    public Guid FormVersionId { get; set; }
    public string State { get; set; } = "draft";
    public string DataJson { get; set; } = "{}";
    public Guid UpdatedBy { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public Guid? ReviewedBy { get; set; }
}

public sealed class ResponseRevision : Entity
{
    public Guid ResponseId { get; set; }
    public long ResponseRevisionNumber { get; set; }
    public Guid ActorId { get; set; }
    public string PreviousJson { get; set; } = "{}";
    public string DataJson { get; set; } = "{}";
    public string Reason { get; set; } = "";
    public string Source { get; set; } = "portal";
    public string? ExternalRecordId { get; set; }
}

public sealed class CollectionBasis : Entity
{
    public Guid SubjectId { get; set; }
    public string Kind { get; set; } = "consent";
    public string Reference { get; set; } = "";
    public Guid? IcfVersionId { get; set; }
    public DateOnly? SignedOn { get; set; }
    public string Purpose { get; set; } = "research";
    public string State { get; set; } = "pending";
    public Guid? ConfirmedBy { get; set; }
    public DateTimeOffset? ConfirmedAt { get; set; }
    public string? DecisionReason { get; set; }
}

public sealed class IcfVersion : Entity
{
    public string State { get; set; } = "published";
    public string DesignersJson { get; set; } = "[]";
    public Guid? ApprovedBy { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public string? ApprovalHash { get; set; }
    public Guid StudyId { get; set; }
    public Guid? SiteId { get; set; }
    public string Name { get; set; } = "";
    public string Version { get; set; } = "";
    public string Locale { get; set; } = "zh-TW";
    public string Content { get; set; } = "";
    public string ApprovalReference { get; set; } = "";
    public bool Active { get; set; } = true;
}

public sealed class DataQuery : Entity
{
    public Guid ResponseId { get; set; }
    public string Path { get; set; } = "";
    public string Question { get; set; } = "";
    public string Answer { get; set; } = "";
    public string State { get; set; } = "open";
    public Guid OpenedBy { get; set; }
    public Guid? ClosedBy { get; set; }
}

public sealed class AuditEvent : Entity
{
    public Guid StudyId { get; set; }
    public Guid? SiteId { get; set; }
    public Guid ActorId { get; set; }
    public string Action { get; set; } = "";
    public string Resource { get; set; } = "";
    public string Reason { get; set; } = "";
}

public sealed class OutboxEvent : Entity
{
    public Guid StudyId { get; set; }
    public Guid? SiteId { get; set; }
    public string Type { get; set; } = "";
    public string PayloadJson { get; set; } = "{}";
    public DateTimeOffset? DeliveredAt { get; set; }
    public int Attempts { get; set; }
}

public sealed class ExportSnapshot : Entity
{
    public Guid StudyId { get; set; }
    public Guid RequestedBy { get; set; }
    public string Purpose { get; set; } = "research";
    public string Reason { get; set; } = "";
    public string SiteIdsJson { get; set; } = "[]";
    public string SubjectIdsJson { get; set; } = "[]";
    public string PayloadJson { get; set; } = "{}";
    public string ContentHash { get; set; } = "";
}

public sealed class ExternalIdentifierMapping : Entity
{
    public Guid StudyId { get; set; }
    public Guid SiteId { get; set; }
    public string SourceSystem { get; set; } = "";
    public string EntityType { get; set; } = "subject";
    public string ExternalId { get; set; } = "";
    public Guid PlatformId { get; set; }
}

public sealed class IntegrationReceipt : Entity
{
    public Guid ActorId { get; set; }
    public string RequestKey { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public string ResultJson { get; set; } = "{}";
}
